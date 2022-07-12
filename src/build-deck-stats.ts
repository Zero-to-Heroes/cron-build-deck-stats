/* eslint-disable @typescript-eslint/no-use-before-define */
import { getConnection, http, logBeforeTimeout, logger, S3 } from '@firestone-hs/aws-lambda-utils';
import { AllCardsService } from '@firestone-hs/reference-data';
import { ObjectList } from 'aws-sdk/clients/s3';
import SqlString from 'sqlstring';
import { constants, gzipSync } from 'zlib';
import { buildDeckDataForNewRows } from './builder';
import { mergeDeckData as buildFinalDeckData } from './merger';
import { DataForRank, DeckData, FinalDeckData, RankForDeckData } from './model';

export const allCards = new AllCardsService();
const s3 = new S3();

const S3_BUCKET_NAME = 'static.zerotoheroes.com';
const S3_FOLDER = `api/ranked/decks`;
const S3_FOLDER_SLICE = `${S3_FOLDER}/slices`;

const NUMBER_OF_DECKS_TO_KEEP = 100;
// /ranked-decks.gz.json`;

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event, context): Promise<any> => {
	const cleanup = logBeforeTimeout(context);
	await allCards.initializeCardsDb();

	// TODO:
	// - reduce the number of decks
	// - build different files for the various time/rank combinations, to reduce the file size
	// - inside the app, implement this reactively, so as not to block the initial load of the app
	const existingDeckData: readonly DeckData[] = await loadExistingDeckData();
	logger.log('existingDeckData', existingDeckData);
	const lastDataTimestamp: number = !existingDeckData?.length
		? null
		: Math.max(...existingDeckData.map(data => data.lastUpdateDate.getTime()));
	logger.log('lastDataTimestamp', lastDataTimestamp);
	const lastDataDate: Date = lastDataTimestamp ? new Date(lastDataTimestamp) : null;
	logger.log('lastDataDate', lastDataDate);
	const replayRows: readonly ShortReplayRow[] = await loadReplayRows(lastDataDate);
	const validRows = replayRows.filter(row => !!row.playerRank && !!row.playerDecklist && !!row.allowGameShare);
	logger.log('replayRows', validRows.length);

	const allRankGroups: readonly RankGroup[] = buildAllRankGroups();
	const gameFormats: ('standard' | 'wild' | 'classic')[] = [
		'standard',
		// 'wild',
		// 'classic'
	];
	const newDeckSlice = buildDeckData(validRows, allRankGroups, gameFormats);
	logger.log('newDeckSlice', newDeckSlice);
	await saveSingleSlice(newDeckSlice);

	const allSlices = [...existingDeckData, newDeckSlice];
	const lastPatch = await getLastConstructedPatch();
	const mergedData: FinalDeckData = buildFinalDeckData(allSlices, allRankGroups, gameFormats, lastPatch);
	await saveFinalFiles(mergedData);

	cleanup();
	return { statusCode: 200, body: null };
};

const buildDeckData = (
	replayRows: readonly ShortReplayRow[],
	allRankGroups: readonly RankGroup[],
	gameFormats: ('standard' | 'wild' | 'classic')[],
): DeckData => {
	return buildDeckDataForNewRows(replayRows, allRankGroups, gameFormats);
};

const buildAllRankGroups = (): readonly RankGroup[] => {
	return [
		{
			id: 'all',
			filter: (row: ShortReplayRow) => true,
		},
		{
			id: 'bronze-platinum',
			filter: (row: ShortReplayRow) => {
				const { league } = extractLeague(row.playerRank);
				return league !== 'legend' && league >= 2;
			},
		},
		{
			id: 'diamond-legend',
			filter: (row: ShortReplayRow) => {
				const { league } = extractLeague(row.playerRank);
				return league === 'legend' || league === 1;
			},
		},
		{
			id: 'legend',
			filter: (row: ShortReplayRow) => {
				const { league } = extractLeague(row.playerRank);
				return league === 'legend';
			},
		},
		{
			id: 'legend-1000',
			filter: (row: ShortReplayRow) => {
				const { league, rank } = extractLeague(row.playerRank);
				return league === 'legend' && rank <= 1000;
			},
		},
		{
			id: 'legend-100',
			filter: (row: ShortReplayRow) => {
				const { league, rank } = extractLeague(row.playerRank);
				return league === 'legend' && rank <= 100;
			},
		},
	];
};

const extractLeague = (playerRank: string): { league: number | 'legend'; rank: number } => {
	if (!playerRank.includes('-')) {
		return { league: null, rank: null };
	}
	const split = playerRank.split('-');
	if (split[0] === 'legend') {
		return { league: 'legend', rank: +split[1] };
	}

	if (isNaN(+split[0]) || isNaN(+split[1])) {
		return { league: null, rank: null };
	}
	return { league: +split[0], rank: +split[1] };
};

const saveFinalFiles = async (finalData: FinalDeckData): Promise<void> => {
	for (const timeData of finalData.statsForTimePeriod) {
		for (const formatData of timeData.deckData.dataForFormat) {
			for (const rankData of formatData.dataForRank) {
				const dataWithLimitedDecks: DataForRank = {
					...rankData,
					deckStats: rankData.deckStats.slice(0, NUMBER_OF_DECKS_TO_KEEP),
				};
				const dataStr = JSON.stringify(dataWithLimitedDecks, null, 4);
				const gzipped = gzipSync(dataStr, {
					level: constants.Z_BEST_COMPRESSION,
				});
				logger.log('gzipped buckets');
				const fileName = `ranked-decks-${formatData.format}-${timeData.timePeriod}-${dataWithLimitedDecks.rankGroup}.gz.json`;
				await s3.writeFile(gzipped, S3_BUCKET_NAME, `${S3_FOLDER}/${fileName}`, 'application/json', 'gzip');
				logger.log('file saved', `${S3_FOLDER}/${fileName}`);
			}
		}
	}
};

const saveSingleSlice = async (deckData: DeckData): Promise<void> => {
	const dataStr = JSON.stringify(deckData, null, 4);
	const gzipped = gzipSync(dataStr, {
		level: constants.Z_BEST_COMPRESSION,
	});
	logger.log('gzipped buckets');
	await s3.writeFile(
		gzipped,
		S3_BUCKET_NAME,
		`${S3_FOLDER_SLICE}/ranked-decks-${new Date().toISOString()}.gz.json`,
		'application/json',
		'gzip',
	);
	logger.log('slice saved', `${S3_FOLDER_SLICE}/ranked-decks-${new Date().toISOString()}.gz.json`);
};

const loadReplayRows = async (lastDataDate: Date): Promise<readonly ShortReplayRow[]> => {
	const mysql = await getConnection();
	const query = `
		SELECT playerName, playerRank, gameFormat, playerDecklist, result, coinPlay, allowGameShare
		FROM replay_summary
		WHERE gameMode = 'ranked'
		AND creationDate >= ${!!lastDataDate ? SqlString.escape(lastDataDate) : 'DATE_SUB(NOW(), INTERVAL 4 HOUR)'};
	`;
	logger.log('\n', new Date().toLocaleString(), 'running query', query);
	const result: readonly ShortReplayRow[] = await mysql.query(query);
	logger.log(new Date().toLocaleString(), 'result', result?.length);
	await mysql.end();
	logger.log(new Date().toLocaleString(), 'connection closed');
	return result;
};

const loadExistingDeckData = async (): Promise<readonly DeckData[]> => {
	const files: ObjectList = await s3.loadAllFileKeys(S3_BUCKET_NAME, S3_FOLDER_SLICE);
	logger.log('fileKeys', files);
	const allContent = await Promise.all(
		files.filter(file => !file.Key.endsWith('/')).map(file => s3.readGzipContent(S3_BUCKET_NAME, file.Key, 1)),
	);
	// Delete old data. The main goal is to keep the number of keys below 1000
	// so that we don't have to handle pagination in the replies
	// Keeping a history of 40 days also allows us to move to hourly updates if
	// we want to get fresh data after patches
	const keysToDelete = files
		.filter(file => Date.now() - file.LastModified.getTime() > 40 * 24 * 60 * 60 * 1000)
		.map(file => file.Key);
	await s3.deleteFiles(S3_BUCKET_NAME, keysToDelete);
	return allContent
		.map(content => JSON.parse(content))
		.map(
			data =>
				({
					...data,
					lastUpdateDate: new Date(data.lastUpdateDate),
				} as DeckData),
		);
};

const getLastConstructedPatch = async (): Promise<PatchInfo> => {
	const patchInfo = await http(`https://static.zerotoheroes.com/hearthstone/data/patches.json`);
	const structuredPatch = JSON.parse(patchInfo);
	const patchNumber = structuredPatch.currentConstructedMetaPatch;
	return structuredPatch.patches.find(patch => patch.number === patchNumber);
};

// Don't forget to update the query when adding fields to the model
export interface ShortReplayRow {
	readonly playerRank: string;
	readonly gameFormat: 'standard' | 'wild' | 'classic';
	readonly playerDecklist: string;
	readonly result: 'won' | 'lost';
	readonly coinPlay: 'coin' | 'play';
	readonly playerName: string;
	readonly allowGameShare: boolean;
}

export interface RankGroup {
	readonly id: RankForDeckData;
	readonly filter: (row: ShortReplayRow) => boolean;
}

export interface PatchInfo {
	readonly number: number;
	readonly version: string;
	readonly name: string;
	readonly date: string;
}
