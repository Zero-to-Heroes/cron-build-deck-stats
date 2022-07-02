import { groupByFunction } from '@firestone-hs/aws-lambda-utils';
import { PatchInfo, RankGroup } from './build-deck-stats';
import { DataForFormat, DataForRank, DeckData, DeckStat, FinalDeckData } from './model';

export const mergeDeckData = (
	data: readonly DeckData[],
	allRankGroups: readonly RankGroup[],
	gameFormats: ('standard' | 'wild' | 'classic')[],
	lastPatch: PatchInfo,
): FinalDeckData => {
	const allTimePeriods: {
		id: 'past-30' | 'past-seven' | 'past-three' | 'last-patch';
		filter: (data: DeckData) => boolean;
	}[] = [
		{
			id: 'past-30',
			filter: (data: DeckData) => Date.now() - data.lastUpdateDate.getTime() <= 30 * 24 * 60 * 60 * 1000,
		},
		{
			id: 'past-seven',
			filter: (data: DeckData) => Date.now() - data.lastUpdateDate.getTime() <= 7 * 24 * 60 * 60 * 1000,
		},
		{
			id: 'past-three',
			filter: (data: DeckData) => Date.now() - data.lastUpdateDate.getTime() <= 3 * 24 * 60 * 60 * 1000,
		},
		{
			id: 'last-patch',
			filter: (data: DeckData) =>
				data.lastUpdateDate > new Date(new Date(lastPatch.date).getTime() + 24 * 60 * 60 * 1000),
		},
	];

	return {
		lastUpdateDate: new Date(),
		statsForTimePeriod: allTimePeriods.map(time => {
			const dataForTimePeriod = data.filter(d => time.filter(d));
			const result: DeckData = {
				lastUpdateDate: new Date(),
				dataForFormat: gameFormats.map(format =>
					mergeFormats(
						format,
						dataForTimePeriod.flatMap(d => d.dataForFormat),
						allRankGroups,
					),
				),
			};
			return {
				timePeriod: time.id,
				deckData: result,
			};
		}),
	};
};

const mergeFormats = (
	format: 'standard' | 'wild' | 'classic',
	formats: readonly DataForFormat[],
	allRankGroups: readonly RankGroup[],
): DataForFormat => {
	return {
		lastUpdateDate: new Date(),
		format: format,
		dataForRank: allRankGroups.map(rank =>
			mergeRanks(
				rank,
				formats.flatMap(f => f.dataForRank).filter(r => r.rankGroup === rank.id),
			),
		),
	};
};

const mergeRanks = (rank: RankGroup, ranks: readonly DataForRank[]): DataForRank => {
	return {
		rankGroup: rank.id,
		dataPoints: ranks.map(r => r.dataPoints).reduce((a, b) => a + b, 0),
		deckStats: mergeStats(ranks.flatMap(r => r.deckStats)),
	};
};

const mergeStats = (stats: readonly DeckStat[]): readonly DeckStat[] => {
	const groupedByDecklist = groupByFunction((stat: DeckStat) => stat.deckstring)(stats);
	return Object.keys(groupedByDecklist)
		.map(deckstring => {
			const decks = groupedByDecklist[deckstring];
			return {
				deckstring: deckstring,
				global: {
					dataPoints: decks.map(deck => deck.global.dataPoints).reduce((a, b) => a + b, 0),
					wins: decks.map(deck => deck.global.wins).reduce((a, b) => a + b, 0),
					losses: decks.map(deck => deck.global.losses).reduce((a, b) => a + b, 0),
					differentUsers: [...new Set(decks.flatMap(d => d.global.playerNames ?? []))].length,
				},
				goingFirst: {
					dataPoints: decks.map(deck => deck.goingFirst.dataPoints).reduce((a, b) => a + b, 0),
					wins: decks.map(deck => deck.goingFirst.wins).reduce((a, b) => a + b, 0),
					losses: decks.map(deck => deck.goingFirst.losses).reduce((a, b) => a + b, 0),
					differentUsers: [...new Set(decks.flatMap(d => d.goingFirst.playerNames ?? []))].length,
				},
				goingSecond: {
					dataPoints: decks.map(deck => deck.goingSecond.dataPoints).reduce((a, b) => a + b, 0),
					wins: decks.map(deck => deck.goingSecond.wins).reduce((a, b) => a + b, 0),
					losses: decks.map(deck => deck.goingSecond.losses).reduce((a, b) => a + b, 0),
					differentUsers: [...new Set(decks.flatMap(d => d.goingSecond.playerNames ?? []))].length,
				},
			};
		})
		.sort((a, b) => b.global.dataPoints - a.global.dataPoints);
};
