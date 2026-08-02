// Current-world roster (baseline: start of 2026).
//
// Figures are approximate, game-balanced representations of open-source estimates
// (IMF/World Bank GDP, UN population, SIPRI/GFP-style military weight). They are
// tuned for playability, not for citation.
//
// Scales
//   gdp        trillions USD, nominal
//   area       thousand km² of land — drives how much territory it holds on the map
//   population millions
//   military   0-100 composite hard-power index (USA = 100)
//   readiness  0-100 share of that power actually deployable this quarter
//   tech       0-100 research/industrial sophistication
//   stability  0-100 institutional resilience (low = coup/collapse risk)
//   influence  0-100 diplomatic + soft power reach
//   unrest     0-100 current domestic agitation
//   growth     baseline % GDP growth per quarter before modifiers

export const REGIONS = [
  { id: 'north-america', name: 'North America', lat: 45, lon: -100 },
  { id: 'latin-america', name: 'Latin America', lat: -15, lon: -60 },
  { id: 'western-europe', name: 'Western Europe', lat: 48, lon: 6 },
  { id: 'eastern-europe', name: 'Eastern Europe', lat: 50, lon: 26 },
  { id: 'eurasia', name: 'Eurasia', lat: 55, lon: 70 },
  { id: 'middle-east', name: 'Middle East', lat: 29, lon: 45 },
  { id: 'africa', name: 'Africa', lat: 2, lon: 20 },
  { id: 'south-asia', name: 'South Asia', lat: 22, lon: 78 },
  { id: 'east-asia', name: 'East Asia', lat: 35, lon: 115 },
  { id: 'southeast-asia', name: 'Southeast Asia', lat: 5, lon: 110 },
  { id: 'oceania', name: 'Oceania', lat: -27, lon: 140 },
];

export const BLOCS = {
  nato: { id: 'nato', name: 'NATO', kind: 'military', cohesion: 72 },
  eu: { id: 'eu', name: 'European Union', kind: 'economic', cohesion: 68 },
  csto: { id: 'csto', name: 'CSTO', kind: 'military', cohesion: 45 },
  brics: { id: 'brics', name: 'BRICS+', kind: 'economic', cohesion: 40 },
  sco: { id: 'sco', name: 'SCO', kind: 'political', cohesion: 42 },
  gcc: { id: 'gcc', name: 'Gulf Cooperation Council', kind: 'economic', cohesion: 55 },
  asean: { id: 'asean', name: 'ASEAN', kind: 'economic', cohesion: 50 },
  au: { id: 'au', name: 'African Union', kind: 'political', cohesion: 38 },
  usAllied: { id: 'usAllied', name: 'US Treaty Network', kind: 'military', cohesion: 65 },

  // Invented organisations of the late 2020s. They are not real, which is the
  // point: a run should be able to produce a world whose alliance map no longer
  // matches the one it started from, and blocs nobody has heard of are the
  // clearest sign of that. Founders are seeded at world creation.
  meridian: {
    id: 'meridian', name: 'Meridian Compact', kind: 'political', cohesion: 34, invented: true,
    founders: ['bra', 'zaf', 'idn', 'mex'],
    brief: 'Middle powers who would rather not be asked to choose a side.',
  },
  lithiumUnion: {
    id: 'lithiumUnion', name: 'Critical Minerals Union', kind: 'economic', cohesion: 47, invented: true,
    founders: ['chl', 'arg', 'aus', 'kaz'],
    brief: 'A producers’ cartel for the metals the energy transition runs on.',
  },
  sentinel: {
    id: 'sentinel', name: 'Sentinel Pact', kind: 'military', cohesion: 58, invented: true,
    founders: ['pol', 'swe', 'fin', 'ukr'],
    brief: 'A frontier defence pact for states that stopped waiting for guarantees.',
  },
  blueWater: {
    id: 'blueWater', name: 'Blue Water Forum', kind: 'military', cohesion: 44, invented: true,
    founders: ['jpn', 'aus', 'phl', 'sgp'],
    brief: 'Maritime democracies coordinating patrols across two oceans.',
  },
  sahelUnion: {
    id: 'sahelUnion', name: 'Sahel Development Union', kind: 'economic', cohesion: 31, invented: true,
    founders: ['nga', 'dza', 'mar', 'eth'],
    brief: 'Infrastructure and water first, sovereignty arguments later.',
  },
  concord: {
    id: 'concord', name: 'Digital Concord', kind: 'political', cohesion: 40, invented: true,
    founders: ['kor', 'che', 'sgp', 'nld'],
    brief: 'A standards bloc for chips, models and the rules that govern them.',
  },
};

// Doctrine drives how an AI-run nation picks its moves each turn.
export const DOCTRINES = {
  hegemon: { label: 'Hegemonic', econ: 0.9, mil: 1.1, dip: 1.1, covert: 1.0, dom: 0.8, aggression: 0.9 },
  expansionist: { label: 'Expansionist', econ: 1.0, mil: 1.3, dip: 0.8, covert: 1.2, dom: 0.7, aggression: 1.3 },
  revisionist: { label: 'Revisionist', econ: 0.7, mil: 1.3, dip: 0.7, covert: 1.4, dom: 0.9, aggression: 1.45 },
  balancer: { label: 'Balancing', econ: 1.0, mil: 0.9, dip: 1.3, covert: 0.9, dom: 1.0, aggression: 0.7 },
  trader: { label: 'Mercantile', econ: 1.4, mil: 0.6, dip: 1.2, covert: 0.7, dom: 1.0, aggression: 0.45 },
  fortress: { label: 'Fortress', econ: 0.8, mil: 1.35, dip: 0.6, covert: 1.0, dom: 1.2, aggression: 0.85 },
  developmental: { label: 'Developmental', econ: 1.4, mil: 0.8, dip: 1.0, covert: 0.7, dom: 1.2, aggression: 0.55 },
  survivalist: { label: 'Survivalist', econ: 0.9, mil: 1.0, dip: 0.8, covert: 1.1, dom: 1.5, aggression: 0.8 },
  isolationist: { label: 'Isolationist', econ: 1.0, mil: 1.0, dip: 0.4, covert: 0.8, dom: 1.3, aggression: 0.6 },
};

/** @type {Array<Object>} */
export const NATIONS = [
  {
    id: 'usa', name: 'United States', adjective: 'American', flag: '🇺🇸', lat: 38.9, lon: -77.0, capital: 'Washington',
    region: 'north-america', government: 'Federal republic', leaderTitle: 'President',
    area: 9147, population: 342, gdp: 29.2, growth: 0.5, military: 100, readiness: 82, tech: 95,
    stability: 58, influence: 94, unrest: 34, nukes: 5044, blocs: ['nato', 'usAllied'],
    doctrine: 'hegemon', tags: ['reserve-currency', 'blue-water-navy', 'global-bases'],
    brief: 'The incumbent superpower: unmatched reach, strained politics, and allies who now hedge.',
  },
  {
    id: 'chn', name: 'China', adjective: 'Chinese', flag: '🇨🇳', lat: 39.9, lon: 116.4, capital: 'Beijing',
    region: 'east-asia', government: 'One-party state', leaderTitle: 'General Secretary',
    area: 9327, population: 1409, gdp: 18.9, growth: 1.1, military: 87, readiness: 74, tech: 84,
    stability: 71, influence: 81, unrest: 24, nukes: 600, blocs: ['brics', 'sco'],
    doctrine: 'expansionist', tags: ['manufacturing-core', 'rare-earths', 'belt-and-road'],
    brief: 'Industrial colossus with a demographic clock, a property hangover, and a Pacific ambition.',
  },
  {
    id: 'ind', name: 'India', adjective: 'Indian', flag: '🇮🇳', lat: 28.6, lon: 77.2, capital: 'New Delhi',
    region: 'south-asia', government: 'Parliamentary democracy', leaderTitle: 'Prime Minister',
    area: 2973, population: 1441, gdp: 4.1, growth: 1.6, military: 71, readiness: 66, tech: 62,
    stability: 62, influence: 64, unrest: 33, nukes: 180, blocs: ['brics', 'sco'],
    doctrine: 'balancer', tags: ['demographic-dividend', 'multi-aligned', 'services-export'],
    brief: 'The swing power everyone courts and nobody controls.',
  },
  {
    id: 'jpn', name: 'Japan', adjective: 'Japanese', flag: '🇯🇵', lat: 35.7, lon: 139.7, capital: 'Tokyo',
    region: 'east-asia', government: 'Constitutional monarchy', leaderTitle: 'Prime Minister',
    area: 365, population: 123, gdp: 4.2, growth: 0.3, military: 59, readiness: 78, tech: 90,
    stability: 77, influence: 63, unrest: 16, nukes: 0, blocs: ['usAllied'],
    doctrine: 'trader', tags: ['aging', 'creditor-nation', 'rearming'],
    brief: 'Quietly rearming after eighty years, and running out of workers while it does.',
  },
  {
    id: 'deu', name: 'Germany', adjective: 'German', flag: '🇩🇪', lat: 52.5, lon: 13.4, capital: 'Berlin',
    region: 'western-europe', government: 'Federal republic', leaderTitle: 'Chancellor',
    area: 349, population: 84, gdp: 4.8, growth: 0.2, military: 53, readiness: 58, tech: 88,
    stability: 68, influence: 67, unrest: 30, nukes: 0, blocs: ['nato', 'eu'],
    doctrine: 'trader', tags: ['export-machine', 'energy-import', 'fiscal-room'],
    brief: 'Europe\'s balance sheet, hunting for the cheap energy and export markets it lost.',
  },
  {
    id: 'gbr', name: 'United Kingdom', adjective: 'British', flag: '🇬🇧', lat: 51.5, lon: -0.1, capital: 'London',
    region: 'western-europe', government: 'Constitutional monarchy', leaderTitle: 'Prime Minister',
    area: 242, population: 69, gdp: 3.7, growth: 0.3, military: 68, readiness: 76, tech: 87,
    stability: 63, influence: 74, unrest: 31, nukes: 225, blocs: ['nato', 'usAllied'],
    doctrine: 'balancer', tags: ['financial-centre', 'intelligence-tier', 'expeditionary'],
    brief: 'Punching above its economy on intelligence, finance, and habit.',
  },
  {
    id: 'fra', name: 'France', adjective: 'French', flag: '🇫🇷', lat: 48.9, lon: 2.4, capital: 'Paris',
    region: 'western-europe', government: 'Semi-presidential republic', leaderTitle: 'President',
    area: 547, population: 66, gdp: 3.3, growth: 0.3, military: 70, readiness: 74, tech: 86,
    stability: 55, influence: 73, unrest: 42, nukes: 290, blocs: ['nato', 'eu'],
    doctrine: 'balancer', tags: ['independent-deterrent', 'africa-footprint', 'nuclear-power'],
    brief: 'Strategic autonomy abroad, permanent street politics at home.',
  },
  {
    id: 'rus', name: 'Russia', adjective: 'Russian', flag: '🇷🇺', lat: 55.8, lon: 37.6, capital: 'Moscow',
    region: 'eurasia', government: 'Presidential autocracy', leaderTitle: 'President',
    area: 16377, population: 143, gdp: 2.3, growth: 0.3, military: 81, readiness: 62, tech: 58,
    stability: 54, influence: 60, unrest: 36, nukes: 5580, blocs: ['csto', 'brics', 'sco'],
    doctrine: 'revisionist', tags: ['sanctioned', 'energy-exporter', 'war-economy'],
    brief: 'A war economy running hot on hydrocarbons, manpower, and grievance.',
  },
  {
    id: 'bra', name: 'Brazil', adjective: 'Brazilian', flag: '🇧🇷', lat: -15.8, lon: -47.9, capital: 'Brasília',
    region: 'latin-america', government: 'Federal republic', leaderTitle: 'President',
    area: 8358, population: 213, gdp: 2.4, growth: 0.6, military: 51, readiness: 55, tech: 55,
    stability: 56, influence: 57, unrest: 35, nukes: 0, blocs: ['brics'],
    doctrine: 'balancer', tags: ['agri-superpower', 'amazon', 'non-aligned'],
    brief: 'Feeds the world, brokers between blocs, argues with itself.',
  },
  {
    id: 'ita', name: 'Italy', adjective: 'Italian', flag: '🇮🇹', lat: 41.9, lon: 12.5, capital: 'Rome',
    region: 'western-europe', government: 'Parliamentary republic', leaderTitle: 'Prime Minister',
    area: 294, population: 59, gdp: 2.4, growth: 0.2, military: 49, readiness: 62, tech: 78,
    stability: 57, influence: 55, unrest: 33, nukes: 0, blocs: ['nato', 'eu'],
    doctrine: 'trader', tags: ['debt-heavy', 'mediterranean', 'migration-frontline'],
    brief: 'Mediterranean gatekeeper with a debt pile and a manufacturing north.',
  },
  {
    id: 'can', name: 'Canada', adjective: 'Canadian', flag: '🇨🇦', lat: 45.4, lon: -75.7, capital: 'Ottawa',
    region: 'north-america', government: 'Constitutional monarchy', leaderTitle: 'Prime Minister',
    area: 9094, population: 41, gdp: 2.3, growth: 0.4, military: 43, readiness: 60, tech: 82,
    stability: 74, influence: 58, unrest: 22, nukes: 0, blocs: ['nato', 'usAllied'],
    doctrine: 'trader', tags: ['resource-rich', 'arctic', 'us-dependent'],
    brief: 'Resource wealth, one customer, and an Arctic that keeps opening.',
  },
  {
    id: 'kor', name: 'South Korea', adjective: 'South Korean', flag: '🇰🇷', lat: 37.6, lon: 127.0, capital: 'Seoul',
    region: 'east-asia', government: 'Presidential republic', leaderTitle: 'President',
    area: 100, population: 52, gdp: 1.95, growth: 0.5, military: 67, readiness: 84, tech: 92,
    stability: 61, influence: 56, unrest: 30, nukes: 0, blocs: ['usAllied'],
    doctrine: 'fortress', tags: ['semiconductors', 'conscription', 'lowest-fertility'],
    brief: 'Chip superpower living inside artillery range of its own history.',
  },
  {
    id: 'mex', name: 'Mexico', adjective: 'Mexican', flag: '🇲🇽', lat: 19.4, lon: -99.1, capital: 'Mexico City',
    region: 'latin-america', government: 'Federal republic', leaderTitle: 'President',
    area: 1943, population: 131, gdp: 1.9, growth: 0.4, military: 39, readiness: 52, tech: 51,
    stability: 47, influence: 46, unrest: 48, nukes: 0, blocs: [],
    doctrine: 'developmental', tags: ['nearshoring', 'cartel-violence', 'us-border'],
    brief: 'Nearshoring windfall on one side of the ledger, cartel sovereignty on the other.',
  },
  {
    id: 'aus', name: 'Australia', adjective: 'Australian', flag: '🇦🇺', lat: -35.3, lon: 149.1, capital: 'Canberra',
    region: 'oceania', government: 'Constitutional monarchy', leaderTitle: 'Prime Minister',
    area: 7682, population: 27, gdp: 1.85, growth: 0.4, military: 47, readiness: 72, tech: 82,
    stability: 78, influence: 53, unrest: 18, nukes: 0, blocs: ['usAllied'],
    doctrine: 'trader', tags: ['aukus', 'critical-minerals', 'china-trade'],
    brief: 'Sells to Beijing, arms with Washington, hopes never to choose.',
  },
  {
    id: 'esp', name: 'Spain', adjective: 'Spanish', flag: '🇪🇸', lat: 40.4, lon: -3.7, capital: 'Madrid',
    region: 'western-europe', government: 'Constitutional monarchy', leaderTitle: 'Prime Minister',
    area: 499, population: 49, gdp: 1.8, growth: 0.5, military: 43, readiness: 62, tech: 75,
    stability: 60, influence: 51, unrest: 32, nukes: 0, blocs: ['nato', 'eu'],
    doctrine: 'trader', tags: ['tourism', 'renewables', 'latin-ties'],
    brief: 'Sunbelt of Europe, bridge to Latin America, chronically regionalist.',
  },
  {
    id: 'idn', name: 'Indonesia', adjective: 'Indonesian', flag: '🇮🇩', lat: -6.2, lon: 106.8, capital: 'Jakarta',
    region: 'southeast-asia', government: 'Presidential republic', leaderTitle: 'President',
    area: 1812, population: 282, gdp: 1.55, growth: 1.2, military: 47, readiness: 58, tech: 48,
    stability: 61, influence: 51, unrest: 31, nukes: 0, blocs: ['asean', 'brics'],
    doctrine: 'developmental', tags: ['nickel', 'archipelago', 'non-aligned'],
    brief: 'The fourth-largest population on earth, finally monetising its own minerals.',
  },
  {
    id: 'tur', name: 'Türkiye', adjective: 'Turkish', flag: '🇹🇷', lat: 39.9, lon: 32.9, capital: 'Ankara',
    region: 'middle-east', government: 'Presidential republic', leaderTitle: 'President',
    area: 770, population: 87, gdp: 1.4, growth: 0.8, military: 63, readiness: 74, tech: 58,
    stability: 48, influence: 59, unrest: 44, nukes: 0, blocs: ['nato'],
    doctrine: 'revisionist', tags: ['drone-exporter', 'straits', 'inflation'],
    brief: 'NATO member, NATO problem: two straits, a drone industry, and its own agenda.',
  },
  {
    id: 'nld', name: 'Netherlands', adjective: 'Dutch', flag: '🇳🇱', lat: 52.4, lon: 4.9, capital: 'Amsterdam',
    region: 'western-europe', government: 'Constitutional monarchy', leaderTitle: 'Prime Minister',
    area: 34, population: 18, gdp: 1.2, growth: 0.4, military: 35, readiness: 68, tech: 89,
    stability: 74, influence: 50, unrest: 24, nukes: 0, blocs: ['nato', 'eu'],
    doctrine: 'trader', tags: ['lithography-monopoly', 'rotterdam', 'trade-hub'],
    brief: 'Owns the machine that makes the machines that make the chips.',
  },
  {
    id: 'sau', name: 'Saudi Arabia', adjective: 'Saudi', flag: '🇸🇦', lat: 24.7, lon: 46.7, capital: 'Riyadh',
    region: 'middle-east', government: 'Absolute monarchy', leaderTitle: 'Crown Prince',
    area: 2150, population: 34, gdp: 1.15, growth: 0.6, military: 56, readiness: 55, tech: 53,
    stability: 60, influence: 62, unrest: 24, nukes: 0, blocs: ['gcc', 'brics'],
    doctrine: 'balancer', tags: ['swing-producer', 'sovereign-fund', 'vision-project'],
    brief: 'Buying a post-oil future with oil money, hedging between Washington and Beijing.',
  },
  {
    id: 'pol', name: 'Poland', adjective: 'Polish', flag: '🇵🇱', lat: 52.2, lon: 21.0, capital: 'Warsaw',
    region: 'eastern-europe', government: 'Parliamentary republic', leaderTitle: 'Prime Minister',
    area: 312, population: 37, gdp: 0.95, growth: 0.8, military: 60, readiness: 80, tech: 70,
    stability: 63, influence: 49, unrest: 28, nukes: 0, blocs: ['nato', 'eu'],
    doctrine: 'fortress', tags: ['rearmament', 'frontline-state', 'logistics-hub'],
    brief: 'Rearming faster than anyone in Europe, and it knows exactly why.',
  },
  {
    id: 'che', name: 'Switzerland', adjective: 'Swiss', flag: '🇨🇭', lat: 46.9, lon: 7.4, capital: 'Bern',
    region: 'western-europe', government: 'Federal republic', leaderTitle: 'Federal President',
    area: 40, population: 9, gdp: 0.98, growth: 0.4, military: 29, readiness: 70, tech: 91,
    stability: 88, influence: 45, unrest: 10, nukes: 0, blocs: [],
    doctrine: 'isolationist', tags: ['neutral', 'banking', 'militia-army'],
    brief: 'Neutrality as a business model, with a mountain full of bunkers behind it.',
  },
  {
    id: 'twn', name: 'Taiwan', adjective: 'Taiwanese', flag: '🇹🇼', lat: 25.0, lon: 121.6, capital: 'Taipei',
    region: 'east-asia', government: 'Semi-presidential republic', leaderTitle: 'President',
    area: 36, population: 23, gdp: 0.85, growth: 0.8, military: 55, readiness: 80, tech: 94,
    stability: 60, influence: 38, unrest: 27, nukes: 0, blocs: [],
    doctrine: 'fortress', tags: ['silicon-shield', 'contested-status', 'strait'],
    brief: 'Makes the world\'s best chips and is the world\'s most dangerous question.',
  },
  {
    id: 'isr', name: 'Israel', adjective: 'Israeli', flag: '🇮🇱', lat: 31.8, lon: 35.2, capital: 'Jerusalem',
    region: 'middle-east', government: 'Parliamentary democracy', leaderTitle: 'Prime Minister',
    area: 22, population: 10, gdp: 0.55, growth: 0.4, military: 64, readiness: 88, tech: 89,
    stability: 50, influence: 47, unrest: 52, nukes: 90, blocs: ['usAllied'],
    doctrine: 'fortress', tags: ['undeclared-deterrent', 'cyber-tier', 'permanent-mobilisation'],
    brief: 'Technological edge, permanent emergency, no strategic depth.',
  },
  {
    id: 'irn', name: 'Iran', adjective: 'Iranian', flag: '🇮🇷', lat: 35.7, lon: 51.4, capital: 'Tehran',
    region: 'middle-east', government: 'Theocratic republic', leaderTitle: 'Supreme Leader',
    area: 1628, population: 91, gdp: 0.43, growth: 0.3, military: 58, readiness: 60, tech: 52,
    stability: 45, influence: 51, unrest: 58, nukes: 0, blocs: ['sco', 'brics'],
    doctrine: 'revisionist', tags: ['threshold-state', 'proxy-network', 'sanctioned'],
    brief: 'A proxy empire on a sanctioned economy, weeks from a bomb it says it doesn\'t want.',
  },
  {
    id: 'ukr', name: 'Ukraine', adjective: 'Ukrainian', flag: '🇺🇦', lat: 50.5, lon: 30.5, capital: 'Kyiv',
    region: 'eastern-europe', government: 'Semi-presidential republic', leaderTitle: 'President',
    area: 579, population: 36, gdp: 0.19, growth: 0.5, military: 62, readiness: 70, tech: 55,
    stability: 44, influence: 44, unrest: 50, nukes: 0, blocs: [],
    doctrine: 'survivalist', tags: ['at-war', 'aid-dependent', 'drone-innovator'],
    brief: 'Fighting the largest land war in Europe since 1945 on other people\'s budgets.',
  },
  {
    id: 'pak', name: 'Pakistan', adjective: 'Pakistani', flag: '🇵🇰', lat: 33.7, lon: 73.1, capital: 'Islamabad',
    region: 'south-asia', government: 'Parliamentary republic', leaderTitle: 'Prime Minister',
    area: 771, population: 251, gdp: 0.41, growth: 0.5, military: 59, readiness: 62, tech: 42,
    stability: 38, influence: 40, unrest: 60, nukes: 170, blocs: ['sco'],
    doctrine: 'survivalist', tags: ['imf-programme', 'army-state', 'water-stress'],
    brief: 'Nuclear-armed, chronically insolvent, and governed from the barracks.',
  },
  {
    id: 'egy', name: 'Egypt', adjective: 'Egyptian', flag: '🇪🇬', lat: 30.0, lon: 31.2, capital: 'Cairo',
    region: 'middle-east', government: 'Presidential republic', leaderTitle: 'President',
    area: 995, population: 116, gdp: 0.42, growth: 0.6, military: 54, readiness: 55, tech: 42,
    stability: 47, influence: 48, unrest: 52, nukes: 0, blocs: ['au', 'brics'],
    doctrine: 'survivalist', tags: ['suez-canal', 'bread-subsidy', 'gulf-funded'],
    brief: 'Owns a chokepoint, imports its bread, and cannot afford instability.',
  },
  {
    id: 'zaf', name: 'South Africa', adjective: 'South African', flag: '🇿🇦', lat: -25.7, lon: 28.2, capital: 'Pretoria',
    region: 'africa', government: 'Parliamentary republic', leaderTitle: 'President',
    area: 1214, population: 63, gdp: 0.42, growth: 0.3, military: 34, readiness: 42, tech: 52,
    stability: 46, influence: 50, unrest: 55, nukes: 0, blocs: ['brics', 'au'],
    doctrine: 'balancer', tags: ['platinum-group', 'grid-crisis', 'non-aligned'],
    brief: 'Africa\'s loudest diplomatic voice, running on an electricity grid that keeps failing.',
  },
  {
    id: 'nga', name: 'Nigeria', adjective: 'Nigerian', flag: '🇳🇬', lat: 9.1, lon: 7.4, capital: 'Abuja',
    region: 'africa', government: 'Federal republic', leaderTitle: 'President',
    area: 911, population: 232, gdp: 0.26, growth: 0.8, military: 38, readiness: 45, tech: 38,
    stability: 40, influence: 44, unrest: 62, nukes: 0, blocs: ['au'],
    doctrine: 'developmental', tags: ['oil-exporter', 'youth-bulge', 'insurgency'],
    brief: 'Africa\'s biggest market and biggest security problem, often in the same state.',
  },
  {
    id: 'vnm', name: 'Vietnam', adjective: 'Vietnamese', flag: '🇻🇳', lat: 21.0, lon: 105.8, capital: 'Hanoi',
    region: 'southeast-asia', government: 'One-party state', leaderTitle: 'General Secretary',
    area: 310, population: 101, gdp: 0.51, growth: 1.5, military: 45, readiness: 66, tech: 50,
    stability: 66, influence: 44, unrest: 22, nukes: 0, blocs: ['asean'],
    doctrine: 'developmental', tags: ['china-plus-one', 'bamboo-diplomacy', 'south-china-sea'],
    brief: 'The factory floor moving out of China, hedging against the neighbour it needs.',
  },
  {
    id: 'sgp', name: 'Singapore', adjective: 'Singaporean', flag: '🇸🇬', lat: 1.35, lon: 103.8, capital: 'Singapore',
    region: 'southeast-asia', government: 'Parliamentary republic', leaderTitle: 'Prime Minister',
    area: 1, population: 6, gdp: 0.56, growth: 0.6, military: 38, readiness: 82, tech: 90,
    stability: 84, influence: 48, unrest: 12, nukes: 0, blocs: ['asean'],
    doctrine: 'trader', tags: ['entrepot', 'malacca', 'sovereign-fund'],
    brief: 'A city that turned a strait into a state.',
  },
  {
    id: 'are', name: 'United Arab Emirates', adjective: 'Emirati', flag: '🇦🇪', lat: 24.5, lon: 54.4, capital: 'Abu Dhabi',
    region: 'middle-east', government: 'Federal monarchy', leaderTitle: 'President',
    area: 84, population: 11, gdp: 0.55, growth: 0.8, military: 46, readiness: 66, tech: 66,
    stability: 72, influence: 55, unrest: 14, nukes: 0, blocs: ['gcc', 'brics'],
    doctrine: 'trader', tags: ['logistics-hub', 'ai-investment', 'sanctions-gap'],
    brief: 'Everyone\'s neutral ground, and everyone\'s money laundry.',
  },
  {
    id: 'swe', name: 'Sweden', adjective: 'Swedish', flag: '🇸🇪', lat: 59.3, lon: 18.1, capital: 'Stockholm',
    region: 'western-europe', government: 'Constitutional monarchy', leaderTitle: 'Prime Minister',
    area: 407, population: 11, gdp: 0.62, growth: 0.4, military: 44, readiness: 74, tech: 88,
    stability: 76, influence: 47, unrest: 26, nukes: 0, blocs: ['nato', 'eu'],
    doctrine: 'balancer', tags: ['defence-industry', 'baltic', 'new-nato'],
    brief: 'Two centuries of neutrality traded in for an Article 5 guarantee.',
  },
  {
    id: 'nor', name: 'Norway', adjective: 'Norwegian', flag: '🇳🇴', lat: 59.9, lon: 10.8, capital: 'Oslo',
    region: 'western-europe', government: 'Constitutional monarchy', leaderTitle: 'Prime Minister',
    area: 366, population: 6, gdp: 0.5, growth: 0.4, military: 36, readiness: 72, tech: 84,
    stability: 84, influence: 46, unrest: 12, nukes: 0, blocs: ['nato'],
    doctrine: 'trader', tags: ['gas-to-europe', 'wealth-fund', 'arctic-flank'],
    brief: 'Europe\'s gas station and the world\'s largest sovereign fund, guarding the High North.',
  },
  {
    id: 'qat', name: 'Qatar', adjective: 'Qatari', flag: '🇶🇦', lat: 25.3, lon: 51.5, capital: 'Doha',
    region: 'middle-east', government: 'Absolute monarchy', leaderTitle: 'Emir',
    area: 12, population: 3, gdp: 0.23, growth: 0.7, military: 33, readiness: 60, tech: 60,
    stability: 74, influence: 52, unrest: 12, nukes: 0, blocs: ['gcc'],
    doctrine: 'balancer', tags: ['lng-giant', 'mediator', 'al-udeid'],
    brief: 'Talks to everyone because it sells gas to everyone.',
  },
  {
    id: 'arg', name: 'Argentina', adjective: 'Argentine', flag: '🇦🇷', lat: -34.6, lon: -58.4, capital: 'Buenos Aires',
    region: 'latin-america', government: 'Federal republic', leaderTitle: 'President',
    area: 2737, population: 46, gdp: 0.7, growth: 0.5, military: 33, readiness: 45, tech: 57,
    stability: 44, influence: 39, unrest: 50, nukes: 0, blocs: [],
    doctrine: 'developmental', tags: ['lithium-triangle', 'shale', 'serial-defaulter'],
    brief: 'Lithium, shale gas, and a century of trying to escape its own currency.',
  },
  {
    id: 'prk', name: 'North Korea', adjective: 'North Korean', flag: '🇰🇵', lat: 39.0, lon: 125.8, capital: 'Pyongyang',
    region: 'east-asia', government: 'Hereditary dictatorship', leaderTitle: 'Supreme Leader',
    area: 120, population: 26, gdp: 0.03, growth: 0.2, military: 52, readiness: 70, tech: 30,
    stability: 62, influence: 24, unrest: 22, nukes: 55, blocs: [],
    doctrine: 'survivalist', tags: ['nuclear-blackmail', 'sanctioned', 'artillery-wall'],
    brief: 'The world\'s poorest nuclear power, and the hardest to price.',
  },
  {
    id: 'tha', name: 'Thailand', adjective: 'Thai', flag: '🇹🇭', lat: 13.8, lon: 100.5, capital: 'Bangkok',
    region: 'southeast-asia', government: 'Constitutional monarchy', leaderTitle: 'Prime Minister',
    area: 511, population: 72, gdp: 0.55, growth: 0.6, military: 43, readiness: 55, tech: 52,
    stability: 52, influence: 42, unrest: 38, nukes: 0, blocs: ['asean'],
    doctrine: 'balancer', tags: ['coup-prone', 'tourism', 'auto-manufacturing'],
    brief: 'A monarchy, an army, and an electorate, in rotating order.',
  },
  {
    id: 'phl', name: 'Philippines', adjective: 'Filipino', flag: '🇵🇭', lat: 14.6, lon: 121.0, capital: 'Manila',
    region: 'southeast-asia', government: 'Presidential republic', leaderTitle: 'President',
    area: 298, population: 118, gdp: 0.48, growth: 1.3, military: 38, readiness: 55, tech: 44,
    stability: 53, influence: 42, unrest: 40, nukes: 0, blocs: ['asean', 'usAllied'],
    doctrine: 'balancer', tags: ['scarborough-shoal', 'remittances', 'us-basing'],
    brief: 'Where the South China Sea dispute actually gets physical.',
  },
  {
    id: 'mys', name: 'Malaysia', adjective: 'Malaysian', flag: '🇲🇾', lat: 3.1, lon: 101.7, capital: 'Kuala Lumpur',
    region: 'southeast-asia', government: 'Constitutional monarchy', leaderTitle: 'Prime Minister',
    area: 329, population: 35, gdp: 0.45, growth: 1.0, military: 37, readiness: 56, tech: 60,
    stability: 62, influence: 42, unrest: 24, nukes: 0, blocs: ['asean'],
    doctrine: 'trader', tags: ['chip-packaging', 'malacca', 'non-aligned'],
    brief: 'Where half the world\'s chips get packaged and shipped.',
  },
  {
    id: 'bgd', name: 'Bangladesh', adjective: 'Bangladeshi', flag: '🇧🇩', lat: 23.8, lon: 90.4, capital: 'Dhaka',
    region: 'south-asia', government: 'Parliamentary republic', leaderTitle: 'Prime Minister',
    area: 130, population: 175, gdp: 0.47, growth: 1.2, military: 36, readiness: 50, tech: 38,
    stability: 44, influence: 34, unrest: 55, nukes: 0, blocs: [],
    doctrine: 'developmental', tags: ['garment-export', 'climate-exposed', 'delta'],
    brief: 'Clothes the world from a delta that the sea is coming for.',
  },
  {
    id: 'kaz', name: 'Kazakhstan', adjective: 'Kazakh', flag: '🇰🇿', lat: 51.2, lon: 71.4, capital: 'Astana',
    region: 'eurasia', government: 'Presidential republic', leaderTitle: 'President',
    area: 2699, population: 20, gdp: 0.29, growth: 0.9, military: 34, readiness: 50, tech: 46,
    stability: 58, influence: 40, unrest: 32, nukes: 0, blocs: ['csto', 'sco'],
    doctrine: 'balancer', tags: ['uranium-leader', 'multi-vector', 'landlocked'],
    brief: 'Sits on the uranium and the pipelines, and refuses to pick a patron.',
  },
  {
    id: 'cze', name: 'Czechia', adjective: 'Czech', flag: '🇨🇿', lat: 50.1, lon: 14.4, capital: 'Prague',
    region: 'eastern-europe', government: 'Parliamentary republic', leaderTitle: 'Prime Minister',
    area: 77, population: 11, gdp: 0.35, growth: 0.6, military: 34, readiness: 68, tech: 74,
    stability: 66, influence: 40, unrest: 26, nukes: 0, blocs: ['nato', 'eu'],
    doctrine: 'trader', tags: ['ammunition-broker', 'industrial', 'atlanticist'],
    brief: 'Small country, outsized role in keeping European artillery fed.',
  },
  {
    id: 'rou', name: 'Romania', adjective: 'Romanian', flag: '🇷🇴', lat: 44.4, lon: 26.1, capital: 'Bucharest',
    region: 'eastern-europe', government: 'Semi-presidential republic', leaderTitle: 'President',
    area: 230, population: 19, gdp: 0.37, growth: 0.7, military: 37, readiness: 62, tech: 62,
    stability: 55, influence: 38, unrest: 34, nukes: 0, blocs: ['nato', 'eu'],
    doctrine: 'fortress', tags: ['black-sea', 'grain-corridor', 'frontline-state'],
    brief: 'The Black Sea flank, and the corridor Ukrainian grain leaves by.',
  },
  {
    id: 'grc', name: 'Greece', adjective: 'Greek', flag: '🇬🇷', lat: 38.0, lon: 23.7, capital: 'Athens',
    region: 'western-europe', government: 'Parliamentary republic', leaderTitle: 'Prime Minister',
    area: 130, population: 10, gdp: 0.26, growth: 0.6, military: 40, readiness: 70, tech: 62,
    stability: 58, influence: 38, unrest: 34, nukes: 0, blocs: ['nato', 'eu'],
    doctrine: 'fortress', tags: ['shipping-fleet', 'aegean-dispute', 'high-defence-spend'],
    brief: 'Owns the merchant fleet, spends like a frontline state, argues with a NATO ally.',
  },
  {
    id: 'chl', name: 'Chile', adjective: 'Chilean', flag: '🇨🇱', lat: -33.4, lon: -70.7, capital: 'Santiago',
    region: 'latin-america', government: 'Presidential republic', leaderTitle: 'President',
    area: 744, population: 20, gdp: 0.36, growth: 0.6, military: 33, readiness: 58, tech: 60,
    stability: 62, influence: 40, unrest: 32, nukes: 0, blocs: [],
    doctrine: 'trader', tags: ['copper-lithium', 'open-economy', 'pacific-alliance'],
    brief: 'Copper and lithium: the metals every energy transition runs on.',
  },
  {
    id: 'col', name: 'Colombia', adjective: 'Colombian', flag: '🇨🇴', lat: 4.7, lon: -74.1, capital: 'Bogotá',
    region: 'latin-america', government: 'Presidential republic', leaderTitle: 'President',
    area: 1109, population: 53, gdp: 0.44, growth: 0.6, military: 40, readiness: 58, tech: 48,
    stability: 48, influence: 40, unrest: 50, nukes: 0, blocs: [],
    doctrine: 'balancer', tags: ['coca-economy', 'venezuela-border', 'us-partner'],
    brief: 'Half a century of insurgency, and the border Venezuela empties across.',
  },
  {
    id: 'ven', name: 'Venezuela', adjective: 'Venezuelan', flag: '🇻🇪', lat: 10.5, lon: -66.9, capital: 'Caracas',
    region: 'latin-america', government: 'Authoritarian republic', leaderTitle: 'President',
    area: 882, population: 28, gdp: 0.11, growth: 0.4, military: 32, readiness: 40, tech: 34,
    stability: 34, influence: 30, unrest: 66, nukes: 0, blocs: [],
    doctrine: 'survivalist', tags: ['largest-reserves', 'sanctioned', 'mass-emigration'],
    brief: 'The world\'s biggest oil reserves, and almost no way to get them out.',
  },
  {
    id: 'dza', name: 'Algeria', adjective: 'Algerian', flag: '🇩🇿', lat: 36.8, lon: 3.1, capital: 'Algiers',
    region: 'africa', government: 'Presidential republic', leaderTitle: 'President',
    area: 2382, population: 47, gdp: 0.27, growth: 0.5, military: 47, readiness: 55, tech: 42,
    stability: 52, influence: 40, unrest: 42, nukes: 0, blocs: ['au'],
    doctrine: 'fortress', tags: ['gas-to-europe', 'russian-arms', 'morocco-rivalry'],
    brief: 'Europe\'s alternative gas supplier, armed by Moscow, feuding with its neighbour.',
  },
  {
    id: 'mar', name: 'Morocco', adjective: 'Moroccan', flag: '🇲🇦', lat: 34.0, lon: -6.8, capital: 'Rabat',
    region: 'africa', government: 'Constitutional monarchy', leaderTitle: 'King',
    area: 446, population: 38, gdp: 0.16, growth: 0.8, military: 38, readiness: 60, tech: 46,
    stability: 62, influence: 42, unrest: 30, nukes: 0, blocs: ['au'],
    doctrine: 'developmental', tags: ['phosphates', 'western-sahara', 'atlantic-gateway'],
    brief: 'Phosphate leverage, an Atlantic port strategy, and a disputed desert.',
  },
  {
    id: 'eth', name: 'Ethiopia', adjective: 'Ethiopian', flag: '🇪🇹', lat: 9.0, lon: 38.8, capital: 'Addis Ababa',
    region: 'africa', government: 'Federal republic', leaderTitle: 'Prime Minister',
    area: 1000, population: 132, gdp: 0.21, growth: 1.3, military: 38, readiness: 52, tech: 32,
    stability: 38, influence: 40, unrest: 62, nukes: 0, blocs: ['au', 'brics'],
    doctrine: 'developmental', tags: ['renaissance-dam', 'landlocked', 'internal-conflict'],
    brief: 'Damming the Nile, hunting for a coastline, holding a federation together by force.',
  },
  {
    id: 'ken', name: 'Kenya', adjective: 'Kenyan', flag: '🇰🇪', lat: -1.3, lon: 36.8, capital: 'Nairobi',
    region: 'africa', government: 'Presidential republic', leaderTitle: 'President',
    area: 569, population: 57, gdp: 0.13, growth: 1.0, military: 31, readiness: 50, tech: 40,
    stability: 50, influence: 40, unrest: 48, nukes: 0, blocs: ['au'],
    doctrine: 'developmental', tags: ['east-africa-hub', 'debt-stress', 'mobile-money'],
    brief: 'East Africa\'s commercial hub, carrying more debt than its revenue likes.',
  },
  {
    id: 'irq', name: 'Iraq', adjective: 'Iraqi', flag: '🇮🇶', lat: 33.3, lon: 44.4, capital: 'Baghdad',
    region: 'middle-east', government: 'Parliamentary republic', leaderTitle: 'Prime Minister',
    area: 434, population: 46, gdp: 0.27, growth: 0.6, military: 40, readiness: 45, tech: 36,
    stability: 38, influence: 34, unrest: 58, nukes: 0, blocs: [],
    doctrine: 'survivalist', tags: ['opec-producer', 'militia-politics', 'us-iran-arena'],
    brief: 'Sovereign on paper; in practice, the arena where Washington and Tehran meet.',
  },
  {
    id: 'nzl', name: 'New Zealand', adjective: 'New Zealand', flag: '🇳🇿', lat: -41.3, lon: 174.8, capital: 'Wellington',
    region: 'oceania', government: 'Constitutional monarchy', leaderTitle: 'Prime Minister',
    area: 263, population: 5, gdp: 0.26, growth: 0.4, military: 26, readiness: 58, tech: 76,
    stability: 80, influence: 40, unrest: 16, nukes: 0, blocs: ['usAllied'],
    doctrine: 'isolationist', tags: ['nuclear-free', 'five-eyes', 'pacific-diplomacy'],
    brief: 'In the intelligence club, out of the nuclear one, far from everything.',
  },
  {
    id: 'fin', name: 'Finland', adjective: 'Finnish', flag: '🇫🇮', lat: 60.2, lon: 24.9, capital: 'Helsinki',
    region: 'western-europe', government: 'Parliamentary republic', leaderTitle: 'Prime Minister',
    area: 303, population: 6, gdp: 0.31, growth: 0.3, military: 40, readiness: 82, tech: 84,
    stability: 80, influence: 42, unrest: 16, nukes: 0, blocs: ['nato', 'eu'],
    doctrine: 'fortress', tags: ['1340km-border', 'total-defence', 'reservist-army'],
    brief: 'Thirteen hundred kilometres of border with Russia, and a plan for every metre.',
  },
  {
    id: 'cub', name: 'Cuba', adjective: 'Cuban', flag: '🇨🇺', lat: 23.1, lon: -82.4, capital: 'Havana',
    region: 'latin-america', government: 'One-party state', leaderTitle: 'President',
    area: 109, population: 11, gdp: 0.06, growth: 0.1, military: 26, readiness: 45, tech: 40,
    stability: 44, influence: 28, unrest: 62, nukes: 0, blocs: [],
    doctrine: 'survivalist', tags: ['embargoed', 'blackouts', 'medical-diplomacy'],
    brief: 'Ninety miles from Florida, running on generators and nostalgia.',
  },
];

/**
 * Lookup for every state the game knows about — the roster above, plus any
 * state invented during a run.
 *
 * NATIONS stays exactly the fifty-six of the 2026 baseline (it is the roster
 * you pick from, and what the relation matrix is built out of). NATIONS_BY_ID
 * also carries breakaways and successor states, so the hundred-odd places that
 * ask "what is this id's flag/name/adjective?" keep working when the answer is
 * a country that did not exist last quarter.
 */
export const NATIONS_BY_ID = Object.fromEntries(NATIONS.map((n) => [n.id, n]));

/** Teach the lookup about a state created mid-run. Loading a save replays these. */
export function registerNation(def) {
  if (!def?.id) return null;
  NATIONS_BY_ID[def.id] = def;
  return def;
}

/** Explicit relationship anchors that history has already decided for us. */
export const RELATION_ANCHORS = [
  ['usa', 'chn', -34], ['usa', 'rus', -62], ['usa', 'gbr', 82], ['usa', 'can', 74],
  ['usa', 'jpn', 78], ['usa', 'kor', 72], ['usa', 'isr', 76], ['usa', 'irn', -78],
  ['usa', 'prk', -80], ['usa', 'deu', 66], ['usa', 'fra', 58], ['usa', 'ind', 52],
  ['usa', 'twn', 58], ['usa', 'mex', 44], ['usa', 'sau', 48], ['usa', 'ukr', 62],
  ['usa', 'ven', -66], ['usa', 'cub', -70], ['usa', 'aus', 80], ['usa', 'phl', 62],
  ['usa', 'tur', 22], ['usa', 'pol', 74], ['usa', 'bra', 34],
  ['chn', 'rus', 66], ['chn', 'prk', 52], ['chn', 'irn', 48], ['chn', 'pak', 68],
  ['chn', 'twn', -80], ['chn', 'jpn', -40], ['chn', 'ind', -38], ['chn', 'phl', -46],
  ['chn', 'vnm', -22], ['chn', 'aus', -18], ['chn', 'kor', -12], ['chn', 'bra', 40],
  ['chn', 'zaf', 44], ['chn', 'sau', 38], ['chn', 'eth', 46], ['chn', 'ken', 40],
  ['rus', 'ukr', -96], ['rus', 'pol', -76], ['rus', 'fin', -58], ['rus', 'swe', -52],
  ['rus', 'gbr', -70], ['rus', 'deu', -50], ['rus', 'fra', -46], ['rus', 'kaz', 40],
  ['rus', 'irn', 52], ['rus', 'prk', 56], ['rus', 'ind', 48], ['rus', 'dza', 44],
  ['rus', 'rou', -60], ['rus', 'tur', 18],
  ['ind', 'pak', -74], ['ind', 'bgd', 22], ['ind', 'jpn', 56], ['ind', 'aus', 54],
  ['isr', 'irn', -92], ['isr', 'sau', 6], ['isr', 'egy', 24], ['isr', 'tur', -44],
  ['irn', 'sau', -34], ['irn', 'irq', 40], ['irn', 'are', -14],
  ['prk', 'kor', -78], ['prk', 'jpn', -70],
  ['tur', 'grc', -40], ['tur', 'dza', 20],
  ['dza', 'mar', -52], ['eth', 'egy', -44],
  ['ven', 'col', -40], ['ven', 'cub', 70],
  ['deu', 'fra', 78], ['deu', 'pol', 52], ['fra', 'gbr', 60],
  ['jpn', 'kor', 34], ['twn', 'jpn', 58],
];

/**
 * Playable roster, sorted so the recognisable powers surface first.
 * Every nation in the file is playable — the game does not gate countries.
 */
export function playableNations() {
  return [...NATIONS].sort((a, b) => powerRank(b) - powerRank(a));
}

/** Rough composite used for sorting and for "great power" checks. */
export function powerRank(nation) {
  return (
    Math.log10(Math.max(nation.gdp, 0.01) * 1000) * 14 +
    nation.military * 0.6 +
    nation.influence * 0.35 +
    nation.tech * 0.2 +
    Math.min(nation.nukes, 500) * 0.01
  );
}
