import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

const MODEL = "@cf/baai/bge-reranker-base";
const DESCRIPTION_LIMIT = 120;
const LOCAL_RESULT_LIMIT = 20;
const RERANK_CONTEXT_LIMIT = 5_000;
const SNIPPET_LIMIT = 600;
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 15_000;
const LEXICAL_BOOST_WEIGHT = 0.10;
const PROXIMITY_BOOST_WEIGHT = 0.05;
const MINIMUM_FUZZY_TOKEN_LENGTH = 5;
const MINIMUM_FUZZY_RATIO = 82;

export async function selectRelevantDirectories(directories, options = {}) {
  const queryTerms = readQueryTerms(options.args ?? []);

  if (queryTerms.length === 0) {
    return directories;
  }

  const rankedEntries = rankEntries(directories, queryTerms);
  const localEntries = rankedEntries.slice(0, LOCAL_RESULT_LIMIT);
  const accountId = options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  const authToken = options.authToken ?? process.env.CLOUDFLARE_AUTH_TOKEN;

  if (!accountId || !authToken) {
    const candidates = await buildCandidates(
      selectContextEntries(directories, rankedEntries),
      options.compactPath ?? ((directory) => directory)
    );
    const selectedEntries = lexicalRerankCandidates(candidates, options.args)
      .slice(0, LOCAL_RESULT_LIMIT)
      .map(({ entry }) => entry);

    return selectedEntries.length > 0
      ? groupEntries(selectedEntries)
      : groupEntries(localEntries);
  }

  const contextEntries = selectContextEntries(directories, rankedEntries);
  const candidates = await buildCandidates(
    contextEntries,
    options.compactPath ?? ((directory) => directory)
  );
  const selectedIndexes = await rerankCandidates(candidates, {
    accountId,
    authToken,
    query: options.args.join(" "),
    fetch: options.fetch
  });
  const selectedEntries = selectEntriesByIndexes(candidates, selectedIndexes);

  return selectedEntries.length > 0
    ? groupEntries(selectedEntries.map(({ entry }) => entry))
    : groupEntries(localEntries);
}

export function readQueryTerms(args) {
  return args
    .flatMap((arg) => arg.split(/\s+/))
    .map((arg) => normalizeSearchText(arg))
    .filter(Boolean);
}

export function rankEntries(directories, queryTerms) {
  return directories
    .flatMap(({ directory, files }) => files.map((file) => ({
      directory,
      file,
      score: scoreFile(directory, file, queryTerms)
    })))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);
}

export function lexicalRerankCandidates(candidates, searchTerms) {
  return candidates
    .map((candidate) => ({
      ...candidate,
      lexicalScore: adjustLexicalScore(
        normalizeBaseScore(candidate.entry.score),
        searchTerms,
        candidate.name,
        `${candidate.description} ${candidate.snippet}`
      )
    }))
    .filter(({ lexicalScore }) => lexicalScore > 0)
    .sort((left, right) => right.lexicalScore - left.lexicalScore);
}

export async function buildCandidates(entries, compactPath) {
  return Promise.all(entries.map(async (entry, index) => ({
    index,
    directory: compactPath(entry.directory),
    name: entry.file.name,
    description: limitText(entry.file.description, DESCRIPTION_LIMIT),
    snippet: await readSnippet(entry.file.path),
    entry
  })));
}

export async function rerankCandidates(candidates, options) {
  const fetchImpl = options.fetch ?? fetch;
  const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/ai/run/${MODEL}`;
  const body = JSON.stringify({
    query: options.query,
    top_k: LOCAL_RESULT_LIMIT,
    contexts: candidates.map((candidate) => ({
      text: buildContextText(candidate)
    }))
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetchImpl(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.authToken}`,
          "Content-Type": "application/json"
        },
        body,
        signal: controller.signal
      });

      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          continue;
        }

        return [];
      }

      return parseRerankIndexes(await response.text());
    } catch {
      if (attempt === MAX_ATTEMPTS) {
        return [];
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return [];
}

export function parseRerankIndexes(text) {
  try {
    const data = JSON.parse(text);
    const response = data.result?.response ?? data.response ?? data.result ?? [];

    return Array.isArray(response)
      ? response
        .map((item) => item.index ?? item.id)
        .filter(Number.isInteger)
      : [];
  } catch {
    return [];
  }
}

function selectEntriesByIndexes(candidates, indexes) {
  const candidatesByIndex = new Map(candidates.map((candidate) => [candidate.index, candidate]));
  const seenIndexes = new Set();
  const selectedCandidates = [];

  for (const index of indexes) {
    if (seenIndexes.has(index) || !candidatesByIndex.has(index)) {
      continue;
    }

    seenIndexes.add(index);
    selectedCandidates.push(candidatesByIndex.get(index));
  }

  return selectedCandidates;
}

function selectContextEntries(directories, rankedEntries) {
  const entries = directories.flatMap(({ directory, files }) => files.map((file) => ({
    directory,
    file,
    score: 0
  })));

  if (entries.length <= RERANK_CONTEXT_LIMIT) {
    return entries;
  }

  const entryScores = new Map(rankedEntries.map((entry) => [entry.file.path, entry.score]));

  return entries
    .map((entry) => ({
      ...entry,
      score: entryScores.get(entry.file.path) ?? 0
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, RERANK_CONTEXT_LIMIT);
}

function groupEntries(entries) {
  const groupedEntries = new Map();

  for (const { directory, file } of entries) {
    const directoryKey = normalizePathKey(directory);
    const fileKey = normalizePathKey(file.path ?? path.join(directory, file.name));

    if (!groupedEntries.has(directoryKey)) {
      groupedEntries.set(directoryKey, {
        directory,
        files: [],
        fileKeys: new Set()
      });
    }

    const group = groupedEntries.get(directoryKey);

    if (group.fileKeys.has(fileKey)) {
      continue;
    }

    group.fileKeys.add(fileKey);
    group.files.push(file);
  }

  return [...groupedEntries.values()]
    .map(({ directory, files }) => ({ directory, files }));
}

function scoreFile(directory, file, queryTerms) {
  const name = normalizeSearchText(file.name);
  const directoryText = normalizeSearchText(directory);
  const description = normalizeSearchText(file.description);

  return queryTerms.reduce((score, term) => {
    if (name.includes(term)) {
      return score + 8;
    }

    if (description.includes(term)) {
      return score + 3;
    }

    if (directoryText.includes(term)) {
      return score + 1;
    }

    return score;
  }, 0);
}

function adjustLexicalScore(baseScore, searchTerms, documentName, documentContent) {
  if (searchTerms.length === 0) {
    return baseScore;
  }

  const documentTokens = tokenize(documentName, documentContent);

  if (documentTokens.length === 0) {
    return baseScore;
  }

  let lexicalScore = 0;
  let proximityScore = 0;

  for (const searchTerm of searchTerms) {
    const queryTokens = tokenize(searchTerm);

    if (queryTokens.length === 0) {
      continue;
    }

    const [termLexicalScore, termProximityScore] = scoreTerm(queryTokens, documentTokens);
    lexicalScore = Math.max(lexicalScore, termLexicalScore);
    proximityScore = Math.max(proximityScore, termProximityScore);
  }

  const boost = (lexicalScore * LEXICAL_BOOST_WEIGHT) + (proximityScore * PROXIMITY_BOOST_WEIGHT);

  return clampScore(baseScore + ((1 - baseScore) * boost));
}

function scoreTerm(queryTokens, documentTokens) {
  const uniqueQueryTokens = [...new Set(queryTokens)];

  if (uniqueQueryTokens.length === 0) {
    return [0, 0];
  }

  const documentTokenPositions = new Map();

  for (let index = 0; index < documentTokens.length; index += 1) {
    const token = documentTokens[index];
    const positions = documentTokenPositions.get(token);

    if (positions) {
      positions.push(index);
    } else {
      documentTokenPositions.set(token, [index]);
    }
  }

  const matchedScores = new Map();
  const matchedPositions = [];

  for (const queryToken of uniqueQueryTokens) {
    const [score, positions] = getBestTokenMatch(queryToken, documentTokenPositions);

    if (score <= 0) {
      continue;
    }

    matchedScores.set(queryToken, score);

    for (const position of positions) {
      matchedPositions.push({ position, token: queryToken });
    }
  }

  const lexicalScore = sumValues(matchedScores) / uniqueQueryTokens.length;

  if (matchedScores.size < 2) {
    return [lexicalScore, 0];
  }

  matchedPositions.sort((left, right) => left.position - right.position);

  const bestSpan = getBestCoveringSpan(matchedPositions, matchedScores.size);

  if (bestSpan === Number.POSITIVE_INFINITY) {
    return [lexicalScore, 0];
  }

  const coverage = sumValues(matchedScores) / uniqueQueryTokens.length;
  const closeness = Math.min(matchedScores.size / bestSpan, 1);

  return [lexicalScore, coverage * closeness];
}

function getBestTokenMatch(queryToken, documentTokenPositions) {
  const exactPositions = documentTokenPositions.get(queryToken);

  if (exactPositions) {
    return [1, exactPositions];
  }

  if (queryToken.length < MINIMUM_FUZZY_TOKEN_LENGTH) {
    return [0, []];
  }

  let bestToken = "";
  let bestRatio = 0;

  for (const documentToken of documentTokenPositions.keys()) {
    if (documentToken.length < MINIMUM_FUZZY_TOKEN_LENGTH) {
      continue;
    }

    const lengthDifference = Math.abs(queryToken.length - documentToken.length);

    if (lengthDifference > Math.max(2, Math.floor(queryToken.length / 3))) {
      continue;
    }

    const ratio = similarityRatio(queryToken, documentToken);

    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestToken = documentToken;
    }
  }

  return bestRatio >= MINIMUM_FUZZY_RATIO
    ? [bestRatio / 100, documentTokenPositions.get(bestToken)]
    : [0, []];
}

function getBestCoveringSpan(matchedPositions, requiredDistinctTokens) {
  const windowCounts = new Map();
  let coveredTokens = 0;
  let bestSpan = Number.POSITIVE_INFINITY;
  let left = 0;

  for (let right = 0; right < matchedPositions.length; right += 1) {
    const rightToken = matchedPositions[right].token;
    const rightCount = windowCounts.get(rightToken) ?? 0;
    windowCounts.set(rightToken, rightCount + 1);

    if (rightCount === 0) {
      coveredTokens += 1;
    }

    while (coveredTokens === requiredDistinctTokens && left <= right) {
      bestSpan = Math.min(bestSpan, matchedPositions[right].position - matchedPositions[left].position + 1);

      const leftToken = matchedPositions[left].token;
      const leftCount = windowCounts.get(leftToken) - 1;

      if (leftCount === 0) {
        windowCounts.delete(leftToken);
        coveredTokens -= 1;
      } else {
        windowCounts.set(leftToken, leftCount);
      }

      left += 1;
    }
  }

  return bestSpan;
}

function similarityRatio(left, right) {
  if (left === right) {
    return 100;
  }

  const maxLength = Math.max(left.length, right.length);

  if (maxLength === 0) {
    return 100;
  }

  return Math.round(((maxLength - levenshteinDistance(left, right)) / maxLength) * 100);
}

function levenshteinDistance(left, right) {
  if (left.length > right.length) {
    [left, right] = [right, left];
  }

  let previous = new Uint16Array(left.length + 1);
  let current = new Uint16Array(left.length + 1);

  for (let index = 0; index <= left.length; index += 1) {
    previous[index] = index;
  }

  for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
    current[0] = rightIndex;

    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[leftIndex] = Math.min(
        previous[leftIndex] + 1,
        current[leftIndex - 1] + 1,
        previous[leftIndex - 1] + substitutionCost
      );
    }

    [previous, current] = [current, previous];
  }

  return previous[left.length];
}

function tokenize(...texts) {
  const tokens = [];
  let token = "";

  for (const text of texts) {
    for (const character of text.normalize("NFD")) {
      if (/\p{Diacritic}/u.test(character)) {
        continue;
      }

      if (/[\p{Letter}\p{Number}]/u.test(character)) {
        token += character.toLowerCase();
        continue;
      }

      if (token.length >= 3) {
        tokens.push(token);
      }

      token = "";
    }

    if (token.length >= 3) {
      tokens.push(token);
    }

    token = "";
  }

  return tokens;
}

function normalizeBaseScore(score) {
  return clampScore(score / (score + 10));
}

function sumValues(map) {
  let sum = 0;

  for (const value of map.values()) {
    sum += value;
  }

  return sum;
}

function clampScore(score) {
  return Math.min(Math.max(score, 0), 1);
}

function buildContextText(candidate) {
  return [
    `Path: ${candidate.directory}/${candidate.name}`,
    `Description: ${candidate.description}`,
    `Snippet: ${candidate.snippet}`
  ].join("\n");
}

async function readSnippet(filePath) {
  let file;

  try {
    file = await open(filePath, constants.O_RDONLY);
    const buffer = Buffer.allocUnsafe(SNIPPET_LIMIT * 4);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);

    return limitText(buffer.subarray(0, bytesRead).toString("utf8"), SNIPPET_LIMIT);
  } catch {
    return "";
  } finally {
    await file?.close();
  }
}

function limitText(text, limit) {
  const normalizedText = text.replace(/\s+/g, " ").trim();

  return normalizedText.length > limit
    ? `${normalizedText.slice(0, limit)}...`
    : normalizedText;
}

function normalizeSearchText(text) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function normalizePathKey(filePath) {
  const resolvedPath = path.resolve(filePath);

  return process.platform === "win32"
    ? resolvedPath.toLowerCase()
    : resolvedPath;
}
