import { logger } from '@firestone-hs/aws-lambda-utils';
import { RankGroup, ShortReplayRow } from './build-deck-stats';
import { DataForFormat, DataForRank, DeckData, DeckStat, RankForDeckData } from './model';

export const buildDeckDataForNewRows = (
	replayRows: readonly ShortReplayRow[],
	allRankGroups: readonly RankGroup[],
	gameModes: readonly ('standard' | 'wild' | 'classic')[],
): DeckData => {
	const dataForFormat = gameModes.map(gameMode => buildDataForFormat(gameMode, replayRows, allRankGroups));
	return {
		lastUpdateDate: new Date(),
		dataForFormat: dataForFormat,
	};
};

const buildDataForFormat = (
	gameFormat: 'standard' | 'wild' | 'classic',
	replayRows: readonly ShortReplayRow[],
	allRankGroups: readonly RankGroup[],
): DataForFormat => {
	const validReplays = replayRows.filter(row => row.gameFormat === gameFormat);
	logger.log('validReplays format', gameFormat, validReplays.length);
	const dataForRank: readonly DataForRank[] = allRankGroups.map(rank => buildDataForRank(rank, validReplays));
	return {
		lastUpdateDate: new Date(),
		format: gameFormat,
		dataForRank: dataForRank,
	};
};

const buildDataForRank = (rank: RankGroup, replayRows: readonly ShortReplayRow[]): DataForRank => {
	const validReplays = replayRows.filter(row => rank.filter(row));
	logger.log('validReplays rank', rank, validReplays.length);
	const deckStats: readonly DeckStat[] = buildDeckStats(rank.id, validReplays);
	return {
		rankGroup: rank.id,
		dataPoints: validReplays.length,
		deckStats: deckStats,
	};
};

const buildDeckStats = (rankId: RankForDeckData, replayRows: ShortReplayRow[]): readonly DeckStat[] => {
	logger.log('buildDeckStats', replayRows?.length);
	const internalResult: { [deckstring: string]: DeckStat } = {};
	for (const replay of replayRows) {
		const existingDeckStat = internalResult[replay.playerDecklist] ?? initEmptyDeckStat(replay.playerDecklist);

		const newStat: DeckStat = {
			...existingDeckStat,
			global: {
				...existingDeckStat.global,
				dataPoints: existingDeckStat.global.dataPoints + 1,
				wins: replay.result === 'won' ? existingDeckStat.global.wins + 1 : existingDeckStat.global.wins,
				losses: replay.result === 'lost' ? existingDeckStat.global.losses + 1 : existingDeckStat.global.losses,
				playerNames: [...new Set([...existingDeckStat.global.playerNames, replay.playerName])],
			},
			goingFirst:
				replay.coinPlay === 'play'
					? {
							...existingDeckStat.goingFirst,
							dataPoints: existingDeckStat.goingFirst.dataPoints + 1,
							wins:
								replay.result === 'won'
									? existingDeckStat.goingFirst.wins + 1
									: existingDeckStat.goingFirst.wins,
							losses:
								replay.result === 'lost'
									? existingDeckStat.goingFirst.losses + 1
									: existingDeckStat.goingFirst.losses,
							playerNames: [...new Set([...existingDeckStat.goingFirst.playerNames, replay.playerName])],
					  }
					: existingDeckStat.goingFirst,
			goingSecond:
				replay.coinPlay === 'coin'
					? {
							...existingDeckStat.goingSecond,
							dataPoints: existingDeckStat.goingSecond.dataPoints + 1,
							wins:
								replay.result === 'won'
									? existingDeckStat.goingSecond.wins + 1
									: existingDeckStat.goingSecond.wins,
							losses:
								replay.result === 'lost'
									? existingDeckStat.goingSecond.losses + 1
									: existingDeckStat.goingSecond.losses,
							playerNames: [...new Set([...existingDeckStat.goingSecond.playerNames, replay.playerName])],
					  }
					: existingDeckStat.goingFirst,
		};

		internalResult[replay.playerDecklist] = newStat;
	}

	// logger.log(
	// 	rankId,
	// 	'AAECAZICBNb5A4mLBOWwBJfvBBL36AOm9QP09gOB9wOE9wPO+QOsgASvgASwgASunwThpASXpQSwpQTerwSNtQTquQSuwASywQQA',
	// 	replayRows.filter(
	// 		row =>
	// 			row.playerDecklist ===
	// 			'AAECAZICBNb5A4mLBOWwBJfvBBL36AOm9QP09gOB9wOE9wPO+QOsgASvgASwgASunwThpASXpQSwpQTerwSNtQTquQSuwASywQQA',
	// 	).length,
	// 	internalResult[
	// 		'AAECAZICBNb5A4mLBOWwBJfvBBL36AOm9QP09gOB9wOE9wPO+QOsgASvgASwgASunwThpASXpQSwpQTerwSNtQTquQSuwASywQQA'
	// 	].global.dataPoints,
	// );
	return Object.values(internalResult).sort((a, b) => b.global.dataPoints - a.global.dataPoints);
};

const initEmptyDeckStat = (deckstring: string): DeckStat => {
	return {
		deckstring: deckstring,
		flatCardsList: [],
		playerClass: null,
		global: {
			dataPoints: 0,
			losses: 0,
			wins: 0,
			playerNames: [],
		},
		goingFirst: {
			dataPoints: 0,
			losses: 0,
			wins: 0,
			playerNames: [],
		},
		goingSecond: {
			dataPoints: 0,
			losses: 0,
			wins: 0,
			playerNames: [],
		},
	};
};
