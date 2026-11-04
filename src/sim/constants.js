// Tunable constants and code tables shared by every sim module.
// Pure data: no imports, no side effects.

export const SAVE_VERSION = 1;

export const CHUNK_SIZE = 16;
export const ZONE_DEPTH = 4; // Chebyshev distance for road access / zoning
export const MIN_MAP_SIZE = 16;
export const MAX_MAP_SIZE = 1024;

// Terrain codes
export const T_GRASS = 0;
export const T_WATER = 1;
export const TERRAIN_NAMES = ['grass', 'water'];

// Road codes (0 = none)
export const R_NONE = 0;
export const R_STREET = 1;
export const R_AVENUE = 2;
export const R_HIGHWAY = 3;
export const ROAD_NAMES = [null, 'street', 'avenue', 'highway'];
export const ROAD_CODE = { street: R_STREET, avenue: R_AVENUE, highway: R_HIGHWAY };
export const ROAD_COST = { street: 10, avenue: 25 }; // dollars per tile
export const ROAD_UPKEEP_CENTS = [0, 50, 120, 0]; // per tile per day, indexed by road code
export const HIGHWAY_LENGTH = 6;

// Zone codes (0 = none)
export const Z_NONE = 0;
export const Z_R = 1;
export const Z_C = 2;
export const Z_I = 3;
export const ZONE_NAMES = [null, 'R', 'C', 'I'];
export const ZONE_CODE = { R: Z_R, C: Z_C, I: Z_I };

// Time
export const TICKS_PER_DAY = 24;
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const TICKS_PER_MONTH = TICKS_PER_DAY * DAYS_PER_MONTH;
export const TICKS_PER_YEAR = TICKS_PER_MONTH * MONTHS_PER_YEAR;
export const TICKS_PER_SECOND = [0, 12, 24, 48]; // indexed by speed

// Economy
export const STARTING_FUNDS = 50000;
export const DEFAULT_TAX = 9;
export const MAX_TAX = 29;
export const LOW_FUNDS_THRESHOLD = 5000;
// Daily tax base in cents per (tax percent point): income = units * taxPct * base
export const TAX_BASE_CENTS = { R: 15, C: 20, I: 18 };

// Growth
export const HOUSEHOLD_SIZE = 3; // residents per household (integer, sim-owned)
export const WORKERS_PER_HOUSEHOLD = 1.5; // labour force = floor(households * 1.5)
export const CONSTRUCTION_DAYS = 3;
export const ABANDON_DAYS = 5;
export const MAX_SPAWN_PER_ZONE_PER_DAY = 4;
export const HIRES_PER_BUILDING_PER_DAY = 4;
export const R_BASE_DEMAND = 25;
export const C_JOBS_PER_RESIDENT = 0.15;
export const I_BASE_JOBS = 20;
export const I_JOBS_PER_RESIDENT = 0.25;
export const TAX_DEMAND_FACTOR = { R: 5, C: 4, I: 4 }; // demand points per tax point away from 9

// Land value
export const LV_BASE = 30;
export const LV_ROAD_NEAR = 15; // road within 2 tiles
export const LV_ROAD_FAR = 8; // road within 4 tiles
export const LV_PER_C = 5;
export const LV_MAX_C = 25;
export const LV_PER_I = 6;
export const LV_MAX_I = 30;
export const LV_RADIUS = 4;

// Notifications
export const MAX_NOTIFICATIONS = 200;
