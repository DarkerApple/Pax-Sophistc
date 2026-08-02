# Pax Sophistc

An AI-narrated geopolitical strategy game set in the world as it is now. **English and Korean (한국어).** Pick any of
**56 real countries**, choose the **world you want to play in**, set a **difficulty from 1 to
10**, and run its foreign, economic and domestic policy quarter by quarter from Q1 2026 onward.

It runs entirely in your browser. No build step, no server, no account. A language model
writes the briefings and judges your freeform orders — and every provider it supports has a
**free tier**. It is also fully playable with no API key at all.

```bash
npm start          # http://localhost:5173
npm test           # 264 engine, orders, treaties, reach, ties, world wars, endgame and translation tests
```

There is nothing to install. `npm start` runs a ~60-line static file server from
`scripts/serve.js`; any static host works just as well (`python3 -m http.server`, GitHub
Pages, Netlify, a USB stick).

---

## What you actually do

Each turn is one **quarter**. You get a budget (a share of GDP), some **political capital**,
and as many orders as your **leadership** is worth. Then the other 55 countries take their
turn, the world throws events at you, wars grind forward, and the books get balanced.

- **Leadership buys slots on the desk.** The order limit used to be four, always, for
  everybody — a government with eighty-per-cent approval, a working civil service, four
  contented factions and eight years of practice got exactly as many decisions as one that
  had just survived a coup. Leadership is the standing of the *office*: public consent,
  the machinery of state, your own coalition, time in the building and the record, minus
  whatever your streets are taking from you. It is worth **two to seven orders a quarter**,
  the panel shows all five components so a slot lost is a slot you can explain, and it
  names what you would have to move to earn the next one. Difficulty shifts the whole
  ladder, which is what makes a hard run feel cramped from the first quarter.
- **The same order cannot be queued twice.** Doing the same thing twice in one quarter was
  never a strategy — it was an oversight that let you stack one modifier and skip the rest
  of the catalogue. Repeating an order against a *different* country is a real plan and is
  still allowed, and orders that contradict each other (two alignment changes, two treaty
  calls, two annexations) will not sit on the desk together.

- **380 orders** across eleven tabs — Quick, Economy, Society, Domestic, Military,
  Diplomacy, Alliances, Ties, Intelligence, Technology and the War Room — from `Fiscal
  Stimulus` and `Semiconductor Self-Sufficiency` to `Close the Strait to Their Shipping`,
  `Enter the War on Their Side` and `Mount an Amphibious Landing`. Every shelf can be sorted by relevance, odds, cost, political capital or name.
- **Every tab reads the room, not just Quick.** A category is a *pool*, not a menu: the
  economy tab of a country that is broke and stagnant offers `Defend the Currency`,
  `Comprehensive Tax Reform` and `Issue a Sovereign Bond`, while a rich and growing one is
  offered `Found a Development Bank`, `Deep-Water Port Expansion` and `Sovereign Wealth
  Fund`. Fifty-four economic instruments exist; thirteen are on the desk. Each tab says how
  many of how many it is showing, every card carries the situation that put it there, no
  single situation may take more than four slots, and a handful of standing instruments sit
  at the bottom so no tab is ever empty. The same ranking trims the list of orders you can
  point at another country in its country file.
- **A Quick tab that reads the room.** **127 one-capital quick orders**, of which you see
  fourteen: the ones that answer *what is actually happening*. `Deploy the Gendarmerie` on
  the fourth night of a riot, `Open the Archives` when your approval is gone, `Deny What You
  Cannot Hold` when the front is collapsing, `Bring Forward the Bond Auction` when the
  treasury is empty, `Recognise the Secession` the quarter a country splits, `Publish the
  Intercepts` when a ladder is near the top, `Invite the Inspectors` when the world has
  started calling you a problem. Every card says which situation put it there, the shelf is
  spread across several of them rather than offering eight answers to one flood, and an
  order with nothing to answer is simply not on it.
- **A War Room** that only appears while you are fighting — **57 orders deep**, and most of
  them move the front, the exhaustion and the casualty count directly rather than only your
  national statistics. Not just *how hard* to fight but *how*: `Mount an Amphibious Landing`,
  `Drop Behind the Line`, `Run a Deception Plan`, `Win the Artillery Duel`, `Invest the City`,
  `Trade Space for Time`, `Roll Back Their Air Defence`, `Escort the Convoys`, `Repair the
  Railheads`, `Commit the Strategic Reserve`, `Relieve the Front Commander`. And what is done
  with the ground and the people once it is taken: `Declare Your War Aims`, `Set the Prisoner
  Policy`, `Screen the Occupied Districts`, `Feed the Districts You Hold`, `Exchange the
  Dead`, `Requisition What You Need`.
- **Wars are named for what they were about.** Not "Russian–Romanian War" but *the Carpathians
  War*, *the War for the Red Sea*, *the Aegean War*, *the American Intervention in Cuba* —
  built from the theatre the fighting is actually in, the declared cause, and whether this
  has happened here before, so the second one is *the Second Caucasus War*.
- **Two budgets, and a credit line.** Orders are paid from cash plus borrowing headroom
  scaled to your GDP and institutional credibility. A deficit costs interest and unrest;
  at the ceiling an emergency programme imposes the adjustment for you. It is never a
  position with no legal move.
- **Freeform orders.** Type anything ("quietly buy up the lithium offtake contracts before
  Beijing does") and your advisers price it, set the odds, and tell you the risk. This is
  the one place the language model touches the rules — and everything it returns is clamped
  before it reaches the simulation (see [Trust boundary](#trust-boundary)).
- **Twenty-five decisions** land on your desk, and none of them is the same shape. Not just
  *concede, stall or refuse*: choices that cost money rather than standing (a bank that will
  not open Monday, a windfall you can spend once), choices where every option is bad (the
  city or the army, a plague ship in the roads, hostages), choices with no reversible answer
  (a general who will not stand down, a verdict, a succession), and choices that are only
  hard because of who at home is watching (an ally calling in the paper, a basing request, a
  refugee column at the border, terms offered mid-war). Each one prices itself — what it
  costs, what the odds are, whether it can be undone — and names which of your four factions
  will be pleased and which will not. You choose, or you decline to choose and pay for that
  too.
- **Things that were nobody's plan.** Riots, epidemics, power-plant failures, industrial
  disasters, earthquakes, harvest failures, currency crises, general strikes, assassinations,
  coups at home and coups next door. Each carries **a stated cause drawn from your own
  state** — a grid failure under sanctions blames spare parts; the same failure in a solvent
  country blames a maintenance backlog nobody funded — and each reports real figures rather
  than a shrug.
- **Five outcome tiers** per order — decisive success, success, partial, failure, backfire —
  driven by your country's real stats, not a flat dice roll. A tech-90 country runs a better
  R&D programme than a tech-40 one.
- **Dominance is dominant.** An order aimed at somebody else is a contest, and it is decided
  by the *ratio* of the capability it turns on, not the difference. A superpower's cyber
  operation against a small state is a formality; the same operation the other way round is
  close to hopeless; between peers it is a real roll. War works the same way — force ratios
  are logarithmic, so an overwhelming advantage overwhelms in two or three quarters while
  near-peers grind for eight.
- **Wars** you start, get dragged into by treaty, or have declared on you. They are decided
  by force ratios, readiness, home ground and exhaustion, and they end in victory,
  stalemate, negotiated peace — or, if a losing nuclear power gets desperate enough and the
  difficulty is high enough, worse. Whoever is winning **takes ground quarter by quarter**;
  a decisive peace keeps it, an exhausted one hands every acre back.
- **The world balances against you.** Attack somebody and the region takes a view. Every
  country carries a **threat** reading built from its share of world power, what it has done
  lately (wars opened, borders moved, states absorbed) and how much ground it has actually
  gained; that reading pulls third parties into the war on the defending side whether or not
  anyone signed a treaty, adds more of them each quarter the war runs, and cools relations
  everywhere in between. A coalition does not need parity — that is the point of one. The
  same arithmetic applies to the AI, so a runaway conqueror finds the board turning on it
  too. Play quietly and none of it fires.
- **Conquest.** A war that is being won by an overwhelming margin does not stop at
  "decisive" — the front keeps moving until the country is taken. Absorbing a country
  outright also needs a real capability gap, so a near-peer can be beaten badly without
  being erased: thirty-to-one takes three quarters, two-to-one moves the border and stops. An absorbed state
  drops out of the world (it stops acting, ranking and being acted on) but stays on
  the books, so the run can say what became of it — and if somebody takes the ground
  back, it is on the map again. Two war-room orders put this in your hands directly:
  **Annex the Occupied Territory** makes what you hold permanent before any peace can
  return it, and **Demand Unconditional Surrender** refuses the negotiated end.
  Occupation is not free: it costs growth, stability and readiness for years, and
  every other government marks you down for it.
- **Countries come apart.** A coup in a fragile state, or a separatist uprising in a big
  unhappy one, can carve a province off into a **new country** — with a generated name in
  both languages, a government, a doctrine, and statistics derived from the parent in
  proportion to the land it took. It then sits on the map with its own colour and its own
  very large grievance.
- **Sides are not fixed.** Governments join and leave NATO, the EU, BRICS+, the CSTO, the
  SCO, the GCC, ASEAN and the African Union during a run — sometimes by event, sometimes
  because their friendships have drifted far enough from their formal commitments that the
  paperwork finally catches up. **You can change sides too**: every bloc carries an accede
  and a withdraw order in the Diplomacy tab, offered only when the invitation is genuinely
  on the table (you need friends inside) or when you are actually a member. Alongside the
  real organisations the board carries **six invented ones** — the Meridian Compact, the
  Critical Minerals Union, the Sentinel Pact, the Blue Water Forum, the Sahel Development
  Union and the Digital Concord — so a run can end with an alliance map that no longer
  looks like the one it started from.

### Who needs whom

There is a second map under the first one. Every country runs some share of itself through
other countries — and which countries, and how much, is derived rather than declared: from
gravity (a big near market beats a small far one), from what each of them actually *is*
(Korea sells chips, Germany buys energy, Taiwan makes something nobody else can), and from
the organisations they belong to. A reserve currency, a base network and a payments system
make a distant market behave like a near one, which is why Korea leans on the American
economy as well as the Chinese one rather than only on the one next door.

- **Exposure is directed.** Mexico's exposure to the United States is nothing like the
  United States' exposure to Mexico, and every consequence turns on that asymmetry.
- **Cutting somebody off costs each of you what *you* had at stake**, not a constant. An
  embargo against a country that needs your market wrecks it and costs you almost nothing;
  the same order pointed the other way is a self-inflicted wound. Sanctions used to be
  −0.4% growth on the target and −0.08% on you, whoever you were and whoever they were.
- **The card tells you which way the leverage runs before you pull the lever** — "they need
  you more", "evenly matched", "you need them more" — and the Ties panel shows the whole
  web: who you lean on, what they supply (energy, components, credit, food, the route
  itself), who leans on you, what is currently shut, and what that costs you in growth
  every quarter.
- **War closes it.** Nobody ships through a front, so the quarter a war starts both
  economies take the loss of everything that ran through the other one. A negotiated peace
  re-opens most of it; the rest has to be rebuilt.
- **A whole tab of commercial statecraft.** Embargo everything or only the three categories
  they cannot make themselves, close a strait, sanction whoever keeps trading with them,
  underwrite their dependence on you until they cannot leave, de-risk a supply chain you
  cannot defend, build the strategic stockpile, buy the chokepoint, form a producers'
  cartel, lend them more than they can repay, or ship them the grain.

### Things you say, and what they say back

Every order in the catalogue used to be a one-way verb. **Twelve demands and offers** are
addressed to a named government with terms attached, and are *answered* — the quarter
after you send them. Market access, transit and overflight, that they leave their bloc,
that they cut off your rival, reparations, a border adjustment, that they vacate what they
are sitting on, an invitation into your camp, an offer to buy territory, that they stand
down, an offer of protection, that they hand over the people they are sheltering.

The answer is computed from things you can see and move — how they feel about you, what
you are asking for, what you could do about a refusal, how much they need your market, who
is standing behind them, how big they are next to you — and the odds are on the card with
those six factors named. They accept, they refuse, or **they come back with a counter-offer
that lands on your desk as a decision**: pay their price, refuse it and press the original
demand in front of everybody watching, or withdraw and eat the cost of having asked.

**It runs both ways.** Other governments send you the same propositions, and one addressed
to you is never resolved behind your back — it arrives as a decision with three answers:
give them it, agree for something in return, or refuse in one paragraph. The card says
whether they are in any position to make a refusal cost you something, because that is the
whole of the decision.

### Wars that make sense on a map

An army that cannot get somewhere does not fight there, and does not end up administering
it. **Reach** is one number, 0–1, for what share of a country's force it can put onto
another country's ground: a shared border is all of it, distance eats it, and a blue-water
navy, an expeditionary tradition, overseas bases or **an ally on the target's border who has
given you basing rights** push the horizon back out.

- **A war is decided by the force each side can bring to the theatre**, not the force it
  owns. A coalition of twelve counts for very little if eleven of them are on the wrong
  ocean — which is the difference between a coalition and a communiqué. Every war card
  lists each belligerent's weight *there*.
- **Ground only moves to somebody who could have marched onto it.** A coalition war used to
  be able to end with a landlocked country administering an island chain it could not have
  sailed to; now, if nobody on the winning side can reach a country, that country loses no
  ground however badly it is losing the war — and the briefing says so: *neither side can
  put an army on the other's ground; this is being fought at sea, in the air and over the
  accounts.*
- **Nobody annexes a country they could not have reached.** If the only winners are an
  ocean away, the state survives its own defeat.

### Ally wars, and the war that becomes everybody's

- **Alliances answer.** A military organisation whose member is attacked polls the rest of
  its membership, weighted by the bloc's own cohesion — and only for the country that was
  actually attacked, so a coalition does not turn into a chain letter. A bloc never invokes
  itself against its own members. **Call the Alliance** convenes the standing council and
  re-opens the question for organisations that already declined once.
- **The other side's alliance mobilises back**, once a hostile bloc is in the field behind
  its own member. That is what turns a war bipolar, and it is the only route by which the
  attacking side ever acquires a second great power.
- **Wars merge.** If the same countries end up on the same sides of two separate wars, it
  was one war: the fronts, the casualties and the occupied ground are folded together and
  the smaller one is remembered as a theatre of the larger.
- **You can walk into a war that is already running**, on either side — `Enter the War on
  Their Side` or `Enter the War Against Them` — or `Declare Armed Neutrality` and trade with
  both of them while escorting your own shipping, which the engine then respects when
  somebody tries to recruit you.
- **And past about 36% of the world's power, with great powers on both sides and ten
  belligerents, it stops being a war and becomes *the* war.** It gets a name of its own —
  *The Great War*, then *The Second Great War* — trade collapses for countries that are not
  even in it, belligerents go onto a total-war footing whether or not the treasury can carry
  it, and every quarter one more neutral is put to the question and usually stops being one.
  The Ties panel warns you as it approaches, with the percentage.

### Treaties, and what paper is worth

There was a `treaties` array in the save from the first commit. One order wrote to it and
nothing ever read it. It is now a system:

- **Seven kinds of paper** — non-aggression, trade and investment, intelligence-sharing,
  basing and transit, mutual defence, extended deterrence, full alliance — each with a
  relation it needs before anybody will sign, a term it runs for, and something it is
  actually worth every quarter (a trade treaty pays, an intelligence pact shows you things,
  a basing agreement keeps your army ready).
- **They expire.** A treaty nobody renews lapses quietly, which is how most of them end. The
  panel tells you which are inside four quarters of the clock.
- **They are believed, or they are not.** Every treaty carries a credibility that rises each
  quarter it is kept, jumps when it is honoured, and collapses when a call is refused.
- **You can act on all of it**: propose any kind, renew the expiring ones, tear one up (and
  watch every *other* government holding your signature revise its opinion), hold joint
  exercises, standardise the arsenals, stand up a joint intelligence cell, convene the
  alliance, underwrite an ally's deficit, open your arsenal to them, or say out loud, in
  terms nobody can walk back, exactly what you would do if they were attacked.

### Allies who actually turn up

- **A defence pact pulls real partners into real wars.** When somebody attacks a country
  you have paper with, you are in it — the chance built from the weight of the treaty, how
  much either side believes it, and how badly it would go for them.
- **A defence pact does not cover a war you started. A full alliance does.** That single
  distinction is the reason to pay for the more expensive one.
- **Invoke the Treaties** calls everyone at once, and you find out in one afternoon what the
  paper was worth. Refusing an obligation you actually signed destroys it — and costs you
  with everybody else who has your signature on something.
- **Allies who stay out still send money and materiel** every quarter, readily to a defender
  and reluctantly to an aggressor.

### The world panel

Borders move, states break apart and governments change sides whether or not you are
watching. The centre column carries a panel that shows it, in three faces:

- **Treaties** — every piece of paper you hold, how long it has left, how much either side
  believes it, exactly who would come if you were attacked and by what obligation, and the
  wars currently being fought with the flags of both sides.
- **Alignments** — every bloc on the board with its live membership and its share of world
  power, which of them you are party to, who has changed sides lately, and which countries
  the rest of the world has started to treat as a threat.
- **Borders** — the states that did not exist when the run started, each with the name it
  gave itself and the statistics it inherited from its parent; the states that no longer
  govern themselves and who administers them; every country's net gain or loss of ground
  since the first quarter; and the log of how each of those things happened.
- **Ties** — the second map: what share of your economy runs through other countries and
  what each of them supplies, who depends on *you*, which way the leverage runs in every
  one of those relationships, what is currently shut and what that is costing you in
  growth, and the propositions waiting on somebody's desk for an answer.
- **Rankings** — ten league tables (power, economy, per head, army, land, people,
  influence, technology, stability, warheads) with your own position always visible, even
  when you are fiftieth.

### Statistics

Every figure is framed rather than flat. The dashboard opens with the quarter's books —
projected growth, revenue against upkeep, and the ground you hold — before you issue a
single order. A country's full file is five sections rather than one grid: **the economy**
(output, per head, next quarter's growth and what is driving it, revenue, collection
efficiency, forces upkeep), **people and ground** (population, land, density, share of the
world), **what it can fight with** (force, readiness, deployable power, warheads, wars),
**whether it holds together** (stability, approval, unrest, technology, each with its band
and its direction), and **how the world sees it** (influence, power rank as a share of the
leading power, friendly and hostile states, how threatening it looks, its blocs and its
sanctions) — plus trend lines for GDP, military and stability across the whole run.

## Why quarter thirty is not quarter six

The engine underneath is the same every turn. What changes is the politics on top of it.

### Four creditors, not a currency

Political capital is not refilled by arithmetic — it is **lent to you** by the general
staff, capital, the street and your own party, and they disagree about everything. Every
one of the 302 orders is read by all four, and **the reading comes from the order's own
shape**: what it costs, what it moves, whether it is covert, whether it starts a war. A
rearmament programme thrills the staff, takes money capital wanted, and conscripts people
the street will miss. Each order card names the faction that wants it and the faction that
will hold it against you.

Each faction also carries a **standing demand with a deadline** — *"readiness above 70 and
keep it there"*, *"bring unrest under 35"*, *"no more backfires; every one of them is our
seat"*. Meet it and they warm to you. Miss it and they do not. Let one fall far enough and
it withdraws consent in its own way: the officer corps stops taking your calls, money
leaves the country, the unions call a general strike, or your own side tables a leadership
challenge.

### One antagonist, with a file

When one country has been trading blows with you for long enough, it stops being one
relationship among fifty-five and becomes **the** one. It gets a name your government uses
for it — *the Twenty-Year Problem*, *the Long Winter* — and a dossier that persists across
quarters and terms and **remembers the specific orders on both sides**. It spends its
quarters on you rather than on whoever else is convenient, and it is markedly more likely
to go to war with you than with anybody else. Let it cool and it lapses; settle it and the
run says so.

### You do not know what they have

Foreign statistics arrive as **a band, not a number** — `56–74`, `0.84× to 1.03×` — and
narrow only as far as your intelligence reaches. Espionage, cyber operations, a source
inside their command and a defector pipeline all buy you a look; sources go cold on their
own; counter-intelligence makes you harder to read. The simulation is never fogged, only
the reading is, which means **you can commit to a war on a ratio your services got wrong**.

### A brief that moves

The mandate is **rewritten every two years from what has actually happened**. A war on your
border turns "grow the economy" into "keep the neighbourhood standing"; a negative treasury
writes "get the books straight"; a rivalry writes "settle the question of ——". Objectives
the world has made irrelevant are struck rather than left to fail, banked ones become
achievements, and the panel says when the next review is due. You are also dealt a **private
ambition** nobody else is told about, worth points at the end.

### Choices you cannot take back

Sixteen of the big programmes are **commitments, not payments**: they draw money every
quarter for years and cost more to cancel than to complete, with the break fee shown from
the day you sign. Acceding to a bloc starts a clock, and walking out before it runs down is
charged for in standing and in every relationship inside it. And you get **one
constitutional amendment per term**.

### The constitution you inherited

Every country carries five clauses that gate what the office may actually do — **term
limits, war powers, emergency powers, treaty ratification, and the press**. They follow
from what kind of state it is: a one-party state has no term limit and may rule by decree;
a parliamentary republic has three terms, needs its own side behind a declaration of war,
and cannot suspend normal government at any price. These are not flavour. A blocked order
is blocked at the point of ordering, with the clause named.

One amendment per term is the only way to widen them. Removing your own term limit is the
obvious use of it — and the country reads it for exactly what it is, in unrest, in approval
and in all four factions at once.

### Terms, not sessions

**The country is the save; a term is a chapter of it.** A term ends in an election rather
than a full stop: approval carries it, your party turns it out, the streets bleed it, and
the record you are running on counts for something. Win, and the next term inherits
everything — the debt, the half-built programmes, the treaties, the borders, the rivalry,
the constitution you amended — and gets a fresh brief and four creditors who remember some
of what you did to them. Lose, and the country goes on without you. The hand-off screen
says exactly what carries over.

The world a run ends in can also be exported as the roster for the next era, so a campaign
is the same engine run twice with the second world written by the first.

### A final act

In the closing year a **world congress** convenes and the assembled governments vote on how
the next order is written: freeze the borders where they stand, ban a class of weapon,
recognise a bloc as legitimate, divide the world into spheres, bind everybody to open trade
or to collective security. **Voting weight is what forty quarters of play produced** — power
share, standing, bloc membership, and how much the room has decided you are the problem. You
may put one clause on the paper and hold three meetings, and your leverage in those meetings
is the mandate you are running on. Quiet diplomacy that never paid out now pays out in one
session.

### How history remembers you

The run closes on a **page from a textbook that does not exist**, assembled from the run's
own event log: what the economy did, which wars were fought and who chose them, which
states appeared and which stopped existing — **named** — the rivalry that defined the
decade, the settlement that closed it, and a one-line epitaph. Everybody's private ambition
is revealed alongside it, and the seed is printed at the bottom so anybody can replay the
same decade.

At the end of your term you are graded across five components against the mandate as it
stands, plus your private ambition and how the settlement went.

## World modes

The world mode sets the *character* of the world; the difficulty slider sets how hard it
pushes back. They compose — Chaotic at difficulty 2 is a wild but survivable ride, Chaotic
at 10 is a shredder.

| | 🕊 Stable World | 🌍 Current World | 🎲 Chaotic World |
|---|---|---|---|
| Crisis frequency | ×0.55 | ×1 | ×2.3 |
| Crisis severity | ×0.7 | ×1 | ×1.55 |
| War risk | ×0.35 | ×1 | ×2.4 |
| Relation swings | ×0.6 | ×1 | ×3.4 |
| Starting alliances | real | real | **scrambled** |
| Black-swan events | — | — | **yes** |
| Surprise wars on you | never | possible | frequent |

**Stable World** is the one to learn on: institutions hold, nobody declares war on you out of
nowhere, and money is easier to find.

**Chaotic World** shakes the alignment map at the start — old friends are not reliably
friends — then keeps it moving. It adds a pool of black-swan events that exist nowhere else:
alignment reversals, market dislocations, technological discontinuities, outright state
failure, improbable windfalls. Same rules, no stability.

## Current World

The starting position is the real one, as of the beginning of 2026: GDP, population,
military weight, technology, stability, nuclear arsenals, bloc membership, and a relations
matrix seeded from geography and alliances then overwritten with the pairs history has
already decided — Russia/Ukraine at −96, India/Pakistan at −74, Israel/Iran at −92.

Figures are approximate and tuned for playability, not for citation. They are game
parameters, not a data source.

Every country is playable, and each card carries a **start rating** — gentle, steady,
demanding, hard or brutal — built from the things that will actually decide your first
decade: solvency and debt, stability and unrest, whether you are already at war, how many
hostile neighbours share your border, whether you sit on a flashpoint, and how much of the
world's attention your weight attracts. The rating is not a mood; each card lists **the
reasons behind it in words** ("two hostile neighbours", "a war already running", "a world
that reacts to everything you do"), so a hard start is a hard start for stated causes.
Switzerland at difficulty 10 is a gentler run than Ukraine at difficulty 5.

The setup screen opens with **six suggested starts** across the whole range rather than a
wall of 56 flags, and the roster can be sorted by name, by power or by how hard it will be.
The United States is not the obvious answer and is not first on the list — being the largest
power buys you room to make mistakes and a world that reacts to every one of them.

**Or invent a country.** Six archetypes — a trading port, a resource republic, an industrial
middle power, a young giant, a fortress state, a new republic — give you a starting shape;
you name it, place it in a region, pick a government, and it is registered into the world
with derived statistics, a capital, relations, neighbours and a seat in the rankings like
anybody else. It plays exactly as a real country does, and the rest of the board treats it
the same way.

## The difficulty slider

One value, 1–10, retunes the whole simulation rather than scaling a single number:

| | Détente (1) | Contested (5) | Doomsday (10) |
|---|---|---|---|
| Revenue | ×1.25 | ×1.03 | ×0.75 |
| Growth | ×1.12 | ×0.93 | ×0.70 |
| Action success | +0 pts | −11 pts | −24 pts |
| Rival aggression | ×0.35 | ×0.99 | ×1.80 |
| Crisis severity | ×0.65 | ×1.03 | ×1.50 |
| Political capital | +2 | +0 | −2 |
| Rivals coordinating against you | 5% | 29% | 60% |
| Nuclear taboo | effectively absolute | strained | breakable |

It also decides how much a good run is worth: the final score is multiplied by ×0.85 at
Détente and ×1.15 at Doomsday.

## Escalation

Provocative orders — sanctions, cyber operations, forward deployments, covert
destabilisation — climb a shared escalation ladder with the country you aim them at, and
the ladder decides how hard the world answers back.

Low on the ladder a sanction draws a protest note. High on it, the same sanction sets off
counter-sanctions, an allied boycott, a covert reprisal and a general mobilisation in the
same quarter — because the ladder controls how many links the chain runs for, how high the
rungs go, and whether their friends join in. Past the last rung, somebody stops writing
notes.

Ladders taper near the top and cool over about seven quiet quarters, so the top of the
scale has to be held rather than parked on. The sidebar shows every ladder you are
standing on.

## The map

A schematic world map — continent outlines with every country plotted at its true latitude
and longitude, sized by live national power. The coastlines carry about a degree of detail,
the significant islands are there, and the inland seas (the Caspian, the Black Sea, the
Great Lakes, Baikal, the Aral) are cut out as holes rather than handed to the countries
around them as territory.

- **Zoom and pan.** Scroll or pinch to zoom, drag to pan, `+` / `−` / `0` on the keyboard, or
  jump straight to Europe, East Asia, the Middle East, the Americas or Africa. Marks keep a
  constant on-screen size as you zoom, so zooming genuinely separates crowded regions rather
  than magnifying a blob — and every country gets a name label once you are close enough to
  read it.
- **Five view modes**, each with its own legend: Relations, Power, Stability, Alignment and
  Conflict.
- **Filled territory with real borders.** Every country holds actual ground, not just a dot.
  The land is rasterised from the continent outlines into one-degree cells and assigned to
  capitals by a fit tuned so each country's claim lands close to its real land area; land no
  country on the roster can reach stays unclaimed. Those cells are then *traced* into closed
  rings, nudged off the lattice by a hash of each corner, and corner-cut — so a border reads
  as a frontier rather than as graph paper, and neighbours still meet exactly. Wars,
  secessions, conquests and land sales move the cells, so what you are looking at is the live
  state of the world. `T` turns the fill off.
- **Drag to pan, pinch to zoom.** Dragging pans rather than sweeping a text selection across
  every label, and two fingers zoom on a touch screen.
- **The front, every quarter.** Ground that changed hands is outlined on the map — this
  quarter's in the critical colour, last quarter's fading behind it — so a war is something
  you watch move rather than only read about.
- **Hover goes to the sidebar, not over the map.** Pointing at a country fills the *Country
  inspector* panel on the left; clicking pins it there, clicking again opens its full file.
  Nothing ever draws on top of the map.

Colour follows one rule per mode: relations are **diverging** (blue ↔ neutral grey ↔ red),
power and stability are **sequential** (one hue, five steps), alignment is **categorical**
(three validated slots plus non-aligned), and conflict uses the **reserved status scale**
paired with a ring so "at war" is never carried by colour alone. Both the light and dark data
palettes are validated for colour-vision deficiency and surface contrast rather than
eyeballed.

The map is scenery, not cartography: bays, straits and small islands are absent, and no line
on it should be read as a claim about a real border.

## On a phone

The three-column command screen collapses to one pane at a time with a switcher across the
top — **Nation**, **Map**, **Briefing**, **Orders** — with the order count and any waiting
decision badged on the tabs. The top bar becomes three scrolling strips instead of a wall of
wrapped buttons, the map fills its box rather than letterboxing into a strip, modals become
bottom sheets, and everything you tap is at least a finger wide. No horizontal page scroll at
any width down to 320px.

## Themes and readability

Five themes, switchable in Setup or Settings and remembered between runs:

| Theme | |
|---|---|
| **Situation Room** | Deep navy command console. The default. |
| **Graphite** | Neutral dark grey, less blue light. |
| **Daylight** | Light paper theme for bright rooms and projectors. |
| **High Contrast** | Pure black, maximum contrast, heavier outlines. |
| **Amber Terminal** | Monochrome CRT with amber phosphor. |

Text size has four settings (compact through extra-large) which scale the entire interface,
not just the body copy.

## Learning the game

- A **How it works** panel on the setup screen explains the loop before you commit to anything.
- The **How to play** dialog opens automatically on your first run and is available from the
  top bar or by pressing `?` at any time.
- Every order card shows **what it actually does** in plain language — `Approval +4`,
  `Growth +0.35/q for 4q`, `Their relations +14` — alongside its cost and success chance.
- Orders that address a problem you currently have are marked **suggested**; ones that can end
  up worse than doing nothing are marked **can backfire**. Blocked orders say exactly what
  they are short of.
- The bottom bar tells you when you are about to end a quarter with money and political
  capital still unspent, which is the commonest beginner mistake.

- **Every figure carries context.** A statistic shows which way it moved this quarter, where
  it puts you in the world, and a plain word for it — `Stability 58 ▲2 · holding · #17 of 56`.
  GDP carries per-head and rank, the treasury carries its share of GDP, and land carries how
  far it has drifted since the day you took office.
- **Your grip** on the left panel reads how much of the quarter is actually yours to shape —
  political capital, public consent, institutional capacity and money, minus everything
  already running without you. It also names what that is.

**Keyboard**

| | |
|---|---|
| `Enter` | End the quarter |
| `1`–`9` | Jump to an order category |
| `Backspace` / `X` | Remove the last order / clear the queue |
| `F` | Write a freeform order |
| `S` | Save the run |
| `V` | Cycle what the map colours by |
| `T` | Show or hide filled territory |
| `G` | Centre the map on your country |
| `P` | Pin or unpin the inspected country |
| `+` `−` `0` | Zoom in, out, reset |
| arrows | Pan the map |
| `,` `.` | Previous / next briefing tab |
| `?` / `Esc` | Help / close whatever is open |

The same table is in the game, generated from `src/ui/keys.js` — a shortcut cannot exist
without being documented and cannot be documented without existing.

## Language

The whole interface ships in **English and Korean**, switchable from **the header on the
setup screen and the top bar in game** — one click, no menus — and remembered between runs. That covers the chrome, all 56 country names and one-line briefs,
all 380 order names and descriptions, the world modes, difficulty tiers, themes, help,
events, decisions, escalation and war text — and the locally generated quarterly briefing,
which is composed from translated fragments rather than translated after the fact.

When an AI provider is configured, the prompts carry the player's language, so the model
writes its briefings, adjudications and adviser replies in Korean too. The world state it
is given stays English for precision.

Typography is **Jua** for headings and large figures and **Gowun Dodum** for body text —
both self-hosted under `assets/fonts/`, both covering Hangul and Latin, so nothing is
fetched at runtime.

Adding a third language means one file: copy `src/i18n/ko.js`, translate the values, and
register it in `src/i18n/index.js`. Anything left untranslated falls back to English rather
than showing a raw key.

## Free AI providers

Pick one in Setup or Settings, paste a key, press **Test connection**. All of these have a
free tier that is enough to play with:

| Provider | Free tier | Get a key |
|---|---|---|
| **Google AI Studio (Gemini)** — the best default | Generous, no card | <https://aistudio.google.com/apikey> |
| **Groq** | Per-minute rate limits, very fast | <https://console.groq.com/keys> |
| **OpenRouter** | Any model ending `:free` | <https://openrouter.ai/keys> |
| **Cerebras** | Free tier, small model list | <https://cloud.cerebras.ai/> |
| **Mistral** | Free experiment tier | <https://console.mistral.ai/api-keys/> |
| **Ollama** | Local, free forever | <https://ollama.com/download> |
| **Custom** | Any OpenAI-compatible endpoint | LM Studio, llama.cpp, vLLM, a proxy |

**Offline mode is a first-class option, not a degraded one.** With no provider configured,
briefings are written by a local generator (`src/ai/offline.js`) that reads the same
mechanical turn report the model would — and it is specific rather than atmospheric: what
moved growth and by how much, what each order actually changed, and the chain of
consequences it set off. Freeform orders are matched against the catalogue by intent, with
country detection and ambition scaling, so "quietly buy up the lithium offtake contracts in
Chile" is priced as a small targeted trade agreement rather than as a generic initiative.

You lose prose variety and the advisers panel; you lose no gameplay. The game also falls
back to it automatically — mid-run, without interrupting you — if your provider
rate-limits, errors, or goes down.

### About your API key

The key is stored in this browser's `localStorage` and sent directly from your browser to
the provider you chose. It never reaches any server of ours, because there isn't one.

That design is only appropriate because these are **your own personal free-tier keys**. Do
not paste a shared, billed, or production key into a client-side app — anyone with access
to that browser profile can read it. If you want a key kept truly secret, run the game
against a local Ollama instance or put your own proxy in front and select **Custom
endpoint**.

For Ollama, start it so the browser is allowed to call it:

```bash
OLLAMA_ORIGINS="*" ollama serve
```

## Trust boundary

The language model is a narrator and an adjudicator. It is never the rules engine.

- The simulation resolves the turn **first** and always succeeds. Narration happens
  afterwards and is best-effort; an API failure can never corrupt or end a run.
- Freeform-order adjudication passes through `src/ai/schema.js`, which clamps every field:
  stat deltas to ±12, relations to ±35, cost to 0–4% of GDP, success to 12–88%, modifier
  duration to 10 quarters. Unknown categories fall back, unknown stat keys are dropped, and
  the model cannot grant itself warheads, invent a country, or target the player.
- Every AI response is parsed defensively (`extractJson` handles code fences, preamble, and
  braces inside strings) and rejected outright rather than half-applied.

`tests/ai.test.js` covers this boundary specifically, including adversarial payloads.

## Determinism

Every random draw goes through one seeded RNG whose state is serialised with the save. The
same seed and the same orders replay the same world, exactly — useful for comparing
strategies, and for bug reports. Set a seed in Setup, or leave it blank for a random one.

## Saving

Runs autosave to `localStorage` after every quarter. **Export run** writes a JSON file you
can reload later or on another machine.

## Layout

```
index.html            shell
styles/main.css       one stylesheet: theme tokens, then components
styles/fonts.css      self-hosted Jua + Gowun Dodum (SIL OFL 1.1)
assets/fonts/         the font subsets those two faces need
scripts/serve.js      dev server, zero dependencies
src/
  data/
    nations.js        the world: 56 countries with capitals, blocs, doctrines, anchors
    geography.js      hand-digitised continent outlines for the map
    scenarios.js      the era registry — a second era is a data file, not a rewrite
  engine/
    rng.js            seeded, serialisable RNG
    difficulty.js     the slider → every knob in the simulation
    worldmodes.js     Stable / Current / Chaotic, composed with difficulty
    consequences.js   escalation ladders and chain reactions
    leadership.js     the standing of the office → how many orders a quarter
    reach.js          who can actually get there, and who therefore takes ground
    dependency.js     the second map: who needs whom, and what closing it costs
    worldwar.js       bloc calls, wars that merge, and the war that goes general
    exchanges.js      demands and offers other governments answer
    factions.js       the four creditors of political capital
    nemesis.js        the rivalry, and the file behind it
    intel.js          what you actually know about somebody else
    mandate.js        the brief, and how history rewrites it
    constitution.js   the rules of the office, and the one amendment
    lifecycle.js      opening a term, closing one, and standing again
    commitments.js    programmes and treaties you cannot simply stop
    congress.js       the closing session and how the room votes
    ambitions.js      what every government privately wanted
    chronicle.js      the page a textbook writes from the run
    territory.js      the land grid, the outlines traced out of it, and the front
    coalitions.js     threat, balancing coalitions, and containment
    treaties.js       the paper: kinds, terms, credibility, allies, aid
    alliances.js      the Alliances tab — proposing, renewing, invoking, tearing up
    waroperations.js  the War Room at the operational level
    warnames.js       what a war gets called, and why
    quickorders.js    the situational quick catalogue
    programmes.js     the standing catalogue: full multi-year programmes
    statecraft.js     secession, conquest, land sales, and changing sides
    causes.js         why an event happened, scored against live state
    finance.js        borrowing, interest, and the emergency programme
    state.js          game construction, relations, serialisation
    actions.js        the catalogue, the situation tags, and the shelf ranking
    effects.js        the shared "something happened to a country" vocabulary
    resolve.js        order → outcome tier → world changes
    opponents.js      how the other 55 countries decide their quarter
    events.js         ambient events, wired to the decision catalogue
    decisions.js      the twenty-five things that land on the desk
    starts.js         how hard each country is to start as, and inventing one
    tradeorders.js    the Ties tab, and the orders that put you in somebody's war
    war.js            declaration, the quarterly grind, and how wars end
    turn.js           the quarter, the economy, scoring, endgame
  ai/
    providers.js      the free-tier provider registry
    client.js         OpenAI-compatible + Gemini wire formats, retries, error mapping
    prompts.js        prompt construction from the mechanical turn report
    schema.js         the clamp layer between the model and the rules
    narrator.js       AI-first with automatic local fallback
    offline.js        the local briefing generator
  i18n/
    index.js          the translation layer, English-fallback by design
    ko.js             the Korean language pack
  ui/
    theme.js          the theme + text-size registry
    context.js        the framing that turns a bare figure into a position
    worldview.js      blocs, breakaway states, occupations and border movement
    keys.js           the keyboard table the handler and the help card share
    map.js            projection, zoom/pan camera, view modes, legends
    setup.js          new-game screen
    game.js           command screen: dashboard, inspector, feed, planner
    dom.js, store.js  helpers and persistence
tests/                engine, orders, treaties, reach, ties, world wars, politics,
                      endgame, desk, territory, coalitions, worldview, AI-boundary,
                      world and translation tests
```

The simulation (`src/engine/`, `src/data/`) has no DOM dependency and runs under plain Node,
which is how the tests exercise it.

## Notes on scope

- The map is a fitted equal-area grid at true latitude/longitude, not a survey. Borders are
  approximate and are meant to move legibly rather than accurately.
- Trade exposure, power projection and bloc cohesion are derived from the same
  game-balanced country sheets as everything else. They are modelled to make decisions
  legible, not to reproduce any real trade statistic.
- Real leaders are never named. The narrator prompt requires offices ("the chancellor"), not
  people.
- This is a game. Its numbers are balanced for play, its events are invented, and none of it
  is a forecast.

## Licence

MIT.
