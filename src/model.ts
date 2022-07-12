export interface FinalDeckData {
	readonly lastUpdateDate: Date;
	readonly statsForTimePeriod: readonly DeckDataForTimePeriod[];
}

export interface DeckDataForTimePeriod {
	readonly timePeriod: TimeForDeckData;
	readonly deckData: DeckData;
}

export interface DeckData {
	readonly lastUpdateDate: Date;
	readonly dataForFormat: readonly DataForFormat[];
}

export interface DataForFormat {
	readonly lastUpdateDate: Date;
	readonly format: FormatForDeckData;
	readonly dataForRank: readonly DataForRank[];
}

export interface DataForRank {
	readonly rankGroup: RankForDeckData;
	readonly deckStats: readonly DeckStat[];
	// Simply aggregates the info from all the deckStats to quickly know the sample size
	readonly dataPoints: number;
}

export interface DeckStat {
	readonly deckstring: string;
	readonly playerClass: string;
	readonly flatCardsList: readonly string[];
	readonly global: DeckStatData;
	readonly goingFirst: DeckStatData;
	readonly goingSecond: DeckStatData;
}

export interface DeckStatData {
	readonly dataPoints: number;
	readonly wins: number;
	readonly losses: number;
	readonly playerNames?: readonly string[];
	readonly differentUsers?: number;
}

export type FormatForDeckData = 'standard' | 'wild' | 'classic';
export type TimeForDeckData = 'all-time' | 'past-30' | 'past-7' | 'past-3' | 'last-patch';
export type RankForDeckData = 'all' | 'bronze-platinum' | 'diamond-legend' | 'legend' | 'legend-1000' | 'legend-100';
