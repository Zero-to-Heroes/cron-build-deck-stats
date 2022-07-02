/* eslint-disable @typescript-eslint/no-use-before-define */
import { getConnection, http, logBeforeTimeout, logger, S3 } from '@firestone-hs/aws-lambda-utils';
import { AllCardsService } from '@firestone-hs/reference-data';
import SqlString from 'sqlstring';
import { constants, gunzip, gunzipSync, gzipSync } from 'zlib';
import { buildDeckDataForNewRows } from './builder';
import { mergeDeckData as buildFinalDeckData } from './merger';
import { DeckData, FinalDeckData, RankGroupIdType } from './model';

const allCards = new AllCardsService();
const s3 = new S3();

const S3_BUCKET_NAME = 'static.zerotoheroes.com';
const S3_FOLDER = `api/ranked/decks`;
const S3_FOLDER_SLICE = `${S3_FOLDER}/slices`;
// /ranked-decks.gz.json`;

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event, context): Promise<any> => {
	const cleanup = logBeforeTimeout(context);
	await allCards.initializeCardsDb();

	// configure S3 to remove files older than 30 / 100 days?
	// send time periods back in results (so for each period, filter the files that we do use to perform the job)

	const existingDeckData: readonly DeckData[] = await loadExistingDeckData();
	logger.log('existingDeckData', existingDeckData);
	const lastDataTimestamp: number = !existingDeckData?.length
		? null
		: Math.max(...existingDeckData.map(data => data.lastUpdateDate.getTime()));
	logger.log('lastDataTimestamp', lastDataTimestamp);
	const lastDataDate: Date = lastDataTimestamp ? new Date(lastDataTimestamp) : null;
	logger.log('lastDataDate', lastDataDate);
	const replayRows: readonly ShortReplayRow[] = await loadReplayRows(lastDataDate);
	const validRows = replayRows.filter(row => !!row.playerRank && !!row.playerDecklist);
	logger.log('replayRows', validRows.length);

	const allRankGroups: readonly RankGroup[] = buildAllRankGroups();
	const gameFormats: ('standard' | 'wild' | 'classic')[] = [
		'standard',
		// 'wild',
		// 'classic'
	];
	const newDeckSlice = buildDeckData(validRows, allRankGroups, gameFormats);
	logger.log('newDeckSlice', newDeckSlice);

	logger.log(
		'AAECAZICBNb5A4mLBOWwBJfvBBL36AOm9QP09gOB9wOE9wPO+QOsgASvgASwgASunwThpASXpQSwpQTerwSNtQTquQSuwASywQQA after',
		newDeckSlice.dataForFormat
			.find(f => f.format === 'standard')
			.dataForRank.find(r => r.rankGroup === 'legend-100')
			.deckStats.find(
				d =>
					d.deckstring ===
					'AAECAZICBNb5A4mLBOWwBJfvBBL36AOm9QP09gOB9wOE9wPO+QOsgASvgASwgASunwThpASXpQSwpQTerwSNtQTquQSuwASywQQA',
			),
	);
	await saveSingleSlice(newDeckSlice);

	const allSlices = [...existingDeckData, newDeckSlice];
	const lastPatch = await getLastConstructedPatch();
	const mergedData: FinalDeckData = buildFinalDeckData(allSlices, allRankGroups, gameFormats, lastPatch);
	await saveFinalFile(mergedData);

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

const saveFinalFile = async (deckData: FinalDeckData): Promise<void> => {
	const dataStr = JSON.stringify(deckData, null, 4);
	const gzipped = gzipSync(dataStr, {
		level: constants.Z_BEST_COMPRESSION,
	});
	logger.log('gzipped buckets');
	await s3.writeFile(gzipped, S3_BUCKET_NAME, `${S3_FOLDER}/ranked-decks.gz.json`, 'application/json', 'gzip');
	logger.log('file saved', `${S3_FOLDER}/ranked-decks.gz.json`);
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
	const fileKeys = await s3.loadAllFileKeys(S3_BUCKET_NAME, S3_FOLDER_SLICE);
	console.log('fileKeys', fileKeys);
	const allContent = await Promise.all(
		fileKeys.filter(key => !key.endsWith('/')).map(key => s3.readGzipContent(S3_BUCKET_NAME, key, 1)),
	);
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
	readonly id: RankGroupIdType;
	readonly filter: (row: ShortReplayRow) => boolean;
}

export interface PatchInfo {
	readonly number: number;
	readonly version: string;
	readonly name: string;
	readonly date: string;
}
