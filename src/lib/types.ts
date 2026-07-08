export type AnswerMode = 'time' | 'transfers' | 'fare';

export interface Station {
  name: string;
  lat: number;
  lon: number;
  group: number;
  feed: string;
}

// Pattern: 同一停車駅列の便の集合。trips[t][i] = stops[i]（駅index）での時刻（0時からの秒、24h超あり）。tripsは始発時刻順
export interface Pattern {
  stops: number[];
  trips: number[][];
}

export interface Line {
  name: string;
  company: string;
  feed: string;
  fare: number | null;
  patterns: Pattern[];
}

export interface FeedInfo {
  name: string;
  fareAvailable: boolean;
}

export interface Network {
  stations: Station[];
  lines: Line[];
  feeds: FeedInfo[];
  transferSec: number;
}

export interface RouteLeg {
  line: number;
  from: number;
  to: number;
}

export interface ItineraryLeg extends RouteLeg {
  dep: number;
  arr: number;
}

export interface Itinerary {
  legs: ItineraryLeg[];
  depart: number;
  arrive: number;
  transfers: number;
  fare: number | null;
}
