export interface FinalDeckData {
	readonly lastUpdateDate: Date;
	readonly statsForTimePeriod: readonly DeckDataForTimePeriod[];
}

export interface DeckDataForTimePeriod {
	readonly timePeriod: 'all-time' | 'past-30' | 'past-seven' | 'past-three' | 'last-patch';
	readonly deckData: DeckData;
}

export interface DeckData {
	readonly lastUpdateDate: Date;
	readonly dataForFormat: readonly DataForFormat[];
}

export interface DataForFormat {
	readonly lastUpdateDate: Date;
	readonly format: 'standard' | 'wild' | 'classic';
	readonly dataForRank: readonly DataForRank[];
}

export interface DataForRank {
	readonly rankGroup: RankGroupIdType;
	readonly deckStats: readonly DeckStat[];
	// Simply aggregates the info from all the deckStats to quickly know the sample size
	readonly dataPoints: number;
}

export interface DeckStat {
	readonly deckstring: string;
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

export type RankGroupIdType = 'all' | 'bronze-platinum' | 'diamond-legend' | 'legend' | 'legend-1000' | 'legend-100';
