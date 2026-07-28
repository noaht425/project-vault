import type { CustomRaceDef } from './noteTypes/settlement'

// Generation content for the Settlement Populator — see settlementGenerator.ts
// for how these are combined. Everything here is generic/placeholder, same
// "mechanism not content" spirit as noteTypes/map.ts's defaultTerrainTypes()
// or travelModes.ts's DEFAULT_TRAVEL_MODES: small seed pools meant to be
// edited, extended, or replaced per campaign, not hand-authored to any one
// world. This is flagged separately from those because it's the first
// feature where the app originates actual text content (names, personality
// lines) rather than just a mechanism the user fills in — confirmed with the
// user before building (see feedback_project_vault_no_campaign_content).

export interface WeightedName {
  name: string
  // Relative frequency vs other names in the same pool — see pickWeighted.
  // Not a percent; only meaningful relative to the other weights nearby.
  weight: number
}

export interface NameBank {
  id: string
  name: string
  firstNamesMale: WeightedName[]
  firstNamesFemale: WeightedName[]
  // Usable by ANY resident regardless of picked gender — see genderPool.
  firstNamesNeutral: WeightedName[]
  lastNames: WeightedName[]
}

export const BASELINE_RACES = [
  'human',
  'elf',
  'tiefling',
  'dwarf',
  'halfling',
  'dragonborn',
  'orc',
  'goliath'
] as const
export type BaselineRace = (typeof BASELINE_RACES)[number]

const common = (name: string): WeightedName => ({ name, weight: 3 })
const normal = (name: string): WeightedName => ({ name, weight: 1 })
const rare = (name: string): WeightedName => ({ name, weight: 0.4 })

/** Weighted pick — higher `.weight` means more likely, but nothing is ever impossible as long as weight > 0. */
function pickWeighted<T extends { weight: number }>(items: T[], rng: () => number): T | null {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0)
  if (items.length === 0 || total <= 0) return items[items.length - 1] ?? null
  let roll = rng() * total
  for (const item of items) {
    roll -= Math.max(0, item.weight)
    if (roll <= 0) return item
  }
  return items[items.length - 1]
}

// Human is deliberately NOT a single Western-European bank — a human
// population is meant to stand in for real-world human diversity, so this
// pool draws a few names each from ~13 world naming traditions (grouped by
// comment below for readability/editability, though at generation time it's
// just one flat pool per gender). Every Human name is weight 1 (uniform):
// weighting any region above another would reintroduce exactly the "one
// culture dominates" problem this list exists to avoid — unlike the other 7
// races below (each a single invented fantasy culture, where "some names
// are more common than others within that culture" is just flavor).
export const BASELINE_NAME_BANKS: NameBank[] = [
  {
    id: 'human',
    name: 'Human',
    firstNamesMale: [
      // English
      normal('Edmund'), normal('Gareth'), normal('Rowan'),
      // French
      normal('Étienne'), normal('Théo'), normal('Julien'),
      // Germanic
      normal('Klaus'), normal('Friedrich'), normal('Otto'),
      // Scandinavian
      normal('Sven'), normal('Bjorn'), normal('Magnus'),
      // Slavic
      normal('Dmitri'), normal('Ivan'), normal('Tomasz'),
      // Italian
      normal('Marco'), normal('Luca'), normal('Enzo'),
      // Spanish / Latin American
      normal('Carlos'), normal('Diego'), normal('Mateo'),
      // Arabic
      normal('Omar'), normal('Yusuf'), normal('Tariq'),
      // West African
      normal('Kwame'), normal('Chidi'), normal('Kofi'),
      // East African
      normal('Amare'), normal('Tewodros'), normal('Juma'),
      // South Asian
      normal('Arjun'), normal('Ravi'), normal('Aarav'),
      // East Asian
      normal('Haruto'), normal('Wei'), normal('Min-jun'),
      // Southeast Asian / Pacific
      normal('Minh'), normal('Koa'), normal('Tavita')
    ],
    firstNamesFemale: [
      // English
      normal('Eleanor'), normal('Beatrice'), normal('Matilda'),
      // French
      normal('Camille'), normal('Margaux'), normal('Odette'),
      // Germanic
      normal('Greta'), normal('Hedwig'), normal('Adelheid'),
      // Scandinavian
      normal('Ingrid'), normal('Astrid'), normal('Freya'),
      // Slavic
      normal('Olga'), normal('Katarina'), normal('Nadia'),
      // Italian
      normal('Giulia'), normal('Alessia'), normal('Chiara'),
      // Spanish / Latin American
      normal('Sofia'), normal('Valentina'), normal('Camila'),
      // Arabic
      normal('Fatima'), normal('Layla'), normal('Amira'),
      // West African
      normal('Amara'), normal('Ama'), normal('Adaeze'),
      // East African
      normal('Amina'), normal('Zola'), normal('Almaz'),
      // South Asian
      normal('Aditi'), normal('Priya'), normal('Ananya'),
      // East Asian
      normal('Yuki'), normal('Mei'), normal('Seo-yeon'),
      // Southeast Asian / Pacific
      normal('Linh'), normal('Leilani'), normal('Malia')
    ],
    firstNamesNeutral: [
      normal('Avery'), // English
      normal('Noel'), // French
      normal('Kai'), // Germanic/Hawaiian/Japanese crossover
      normal('Eli'), // Scandinavian
      normal('Sasha'), // Slavic
      normal('Andrea'), // Italian (traditionally male in Italy, female elsewhere)
      normal('Guadalupe'), // Spanish
      normal('Nour'), // Arabic
      normal('Ade'), // West African
      normal('Amani'), // East African (Swahili)
      normal('Kiran'), // South Asian
      normal('Ren') // East Asian
    ],
    lastNames: [
      // English
      normal('Ashford'), normal('Hollis'), normal('Blackwell'),
      // French
      normal('Beaumont'), normal('Lavigne'), normal('Rousseau'),
      // Germanic
      normal('Schmidt'), normal('Weber'), normal('Baumann'),
      // Scandinavian
      normal('Larsen'), normal('Nilsson'), normal('Berg'),
      // Slavic
      normal('Volkov'), normal('Nowak'), normal('Kowalski'),
      // Italian
      normal('Rossi'), normal('Bianchi'), normal('Moretti'),
      // Spanish / Latin American
      normal('Reyes'), normal('Morales'), normal('Castillo'),
      // Arabic
      normal('Haddad'), normal('Farouk'), normal('Khalil'),
      // West African
      normal('Adeyemi'), normal('Mensah'), normal('Okafor'),
      // East African
      normal('Abebe'), normal('Haile'), normal('Mwangi'),
      // South Asian
      normal('Sharma'), normal('Patel'), normal('Rao'),
      // East Asian
      normal('Tanaka'), normal('Wang'), normal('Kim'),
      // Southeast Asian / Pacific
      normal('Tran'), normal('Santos'), normal('Kealoha')
    ]
  },
  {
    id: 'elf',
    name: 'Elf',
    firstNamesMale: [
      common('Faelar'), normal('Galinor'), normal('Halithir'), common('Keldrin'),
      normal('Orindel'), normal('Pelathir'), normal('Talarion'), normal('Doryen'),
      rare('Berenil'), normal('Ithlyn'), normal('Maevir'), common('Silvaen')
    ],
    firstNamesFemale: [
      common('Elowen'), normal('Caelynn'), common('Lysera'), normal('Rialenne'),
      normal('Aelith'), normal('Vaelora'), normal('Nyeliss'), normal('Ithrielle'),
      normal('Saevina'), common('Miriel'), normal('Aerwen'), rare('Calithra')
    ],
    firstNamesNeutral: [common('Sael'), normal('Ren'), normal('Fyrn'), normal('Lio'), rare('Vell')],
    lastNames: [
      common('Duskwhisper'), normal('Emberfall'), normal('Frostwillow'), common('Greyleaf'),
      normal('Hollowbrook'), normal('Ironvale'), normal('Lightward'), common('Moonbriar'),
      normal('Nightshade'), common('Silverbough'), normal('Starfallen'), normal('Swiftwind'),
      normal('Thornveil'), normal('Wintershade'), rare('Duskmere'), normal('Willowmere'),
      normal('Fernhollow'), normal('Brightwood'), rare('Shadewillow'), normal('Dawnbrook')
    ]
  },
  {
    id: 'tiefling',
    name: 'Tiefling',
    firstNamesMale: [
      common('Akros'), normal('Vaspian'), common('Ryven'), normal('Corvin'),
      normal('Kaelris'), normal('Malchion'), normal('Zaraith'), normal('Ondrek'),
      normal('Vexal'), rare('Damaric'), normal('Ithrek'), normal('Sorvane')
    ],
    firstNamesFemale: [
      common('Zephyra'), common('Seraphine'), normal('Ophira'), normal('Thessaly'),
      normal('Ilvara'), normal('Morwenna'), normal('Azurine'), normal('Kestrel'),
      normal('Nyxara'), normal('Ravenna'), rare('Sathiel'), normal('Voxelle')
    ],
    firstNamesNeutral: [common('Cael'), normal('Nocturne'), normal('Vexen'), normal('Ashira'), rare('Rael')],
    lastNames: [
      common('Ashborn'), common('Cinderfall'), normal('Duskhorn'), normal('Emberlash'),
      normal('Grimwick'), normal('Hollowfang'), normal('Ironbrand'), common('Nightfall'),
      normal('Shadowmere'), normal('Smokewreath'), normal('Blackthorn'), normal('Duskveil'),
      rare('Cindermoor'), normal('Hollowsworn'), normal('Ashvale'), normal('Grimhollow'),
      normal('Nightbrand'), rare('Vexmoor'), normal('Cinderhall'), normal('Duskbrand')
    ]
  },
  {
    id: 'dwarf',
    name: 'Dwarf',
    firstNamesMale: [
      common('Borin'), normal('Eldrin'), normal('Grombar'), normal('Kildrak'),
      normal('Modrin'), normal('Orvald'), normal('Skarr'), common('Thrain'),
      normal('Ulfar'), rare('Wilbrek'), normal('Dagrun'), normal('Torvik')
    ],
    firstNamesFemale: [
      common('Dagna'), common('Hilde'), normal('Lorna'), normal('Nissa'),
      normal('Runa'), normal('Volda'), normal('Brenna'), normal('Gudrun'),
      normal('Signe'), normal('Thyra'), normal('Brynna'), rare('Kagda')
    ],
    firstNamesNeutral: [common('Fenn'), normal('Rok'), normal('Dain'), normal('Skye'), rare('Brok')],
    lastNames: [
      common('Stonefist'), common('Ironbeard'), normal('Deepdelve'), normal('Goldvein'),
      normal('Hearthstone'), normal('Rockbrow'), common('Steelforge'), normal('Coalridge'),
      normal('Emberforge'), normal('Granitehall'), normal('Ashenpeak'), normal('Mossbeard'),
      normal('Cragholm'), normal('Ironroot'), rare('Deepforge'), normal('Stonewarden'),
      normal('Coppervein'), normal('Frosthammer'), normal('Anvilheart'), rare('Ironvein')
    ]
  },
  {
    id: 'halfling',
    name: 'Halfling',
    firstNamesMale: [
      common('Alder'), normal('Colby'), normal('Fennick'), normal('Gorse'),
      common('Jasper'), normal('Linden'), normal('Otho'), normal('Rosco'),
      normal('Tolman'), normal('Bramwell'), rare('Cotton'), normal('Digby')
    ],
    firstNamesFemale: [
      common('Daisy'), common('Holly'), normal('Marigold'), normal('Nettle'),
      normal('Pippa'), normal('Bryony'), normal('Poppy'), normal('Primrose'),
      normal('Rue'), normal('Tansy'), rare('Willa'), normal('Clover')
    ],
    firstNamesNeutral: [common('Sorrel'), normal('Fern'), normal('Wren'), normal('Berry'), rare('Ash')],
    lastNames: [
      common('Underbrush'), common('Barrelfoot'), normal('Cobblestone'), normal('Fairweather'),
      common('Goodbarrel'), normal('Hilltopple'), normal('Leafwhistle'), normal('Mossback'),
      normal('Nimblefinger'), normal('Proudpaw'), normal('Quickstep'), normal('Thistledown'),
      normal('Applecross'), normal('Berrywick'), rare('Honeyfoot'), normal('Puddlefoot'),
      normal('Tealeaf'), normal('Windwhistle'), rare('Nutbrown'), normal('Sweetwater')
    ]
  },
  {
    id: 'dragonborn',
    name: 'Dragonborn',
    firstNamesMale: [
      common('Vaeros'), normal('Zhorath'), normal('Kaelith'), common('Rhaskos'),
      normal('Ilvantor'), normal('Draventh'), normal('Korrash'), normal('Vhalkir'),
      normal('Ashkar'), rare('Mordrek'), normal('Thessarian'), normal('Grethis')
    ],
    firstNamesFemale: [
      common('Nyvrasa'), normal('Sylvraketh'), normal('Vashira'), common('Kethrala'),
      normal('Draxenne'), normal('Ilvashka'), normal('Rhozana'), normal('Zaethyr'),
      normal('Morvexa'), rare('Thessika'), normal('Vraelith'), normal('Kashera')
    ],
    firstNamesNeutral: [common('Vex'), normal('Zharn'), normal('Kael'), normal('Rhaz'), rare('Ith')],
    lastNames: [
      common('Emberclaw'), common('Stormscale'), normal('Ironwing'), normal('Duskflame'),
      normal('Goldhorn'), normal('Bronzetail'), normal('Shadowvane'), normal('Frostmane'),
      normal('Cinderwing'), normal('Thornscale'), normal('Emberhorn'), rare('Stormtail'),
      normal('Ashwing'), normal('Goldscale'), normal('Duskclaw'), normal('Ironscale'),
      rare('Bronzeflame'), normal('Frostwing'), normal('Shadowhorn'), normal('Cinderscale')
    ]
  },
  {
    id: 'orc',
    name: 'Orc',
    firstNamesMale: [
      common('Ruk'), common('Thok'), normal('Ghazan'), normal('Vrog'),
      normal('Korgath'), normal('Skarn'), normal('Brakka'), normal('Grumak'),
      normal('Bruk'), rare('Horgan'), normal('Drazul'), normal('Mogrek')
    ],
    firstNamesFemale: [
      common('Malka'), common('Ursha'), normal('Drenna'), normal('Uzza'),
      normal('Nazka'), normal('Yaggra'), normal('Zulka'), normal('Ragna'),
      normal('Skava'), rare('Vorka'), normal('Grishna'), normal('Thazra')
    ],
    firstNamesNeutral: [common('Grix'), normal('Zag'), normal('Krun'), normal('Vosh'), rare('Dun')],
    lastNames: [
      common('Bloodfang'), common('Skullcrusher'), normal('Ironjaw'), normal('Stonejaw'),
      normal('Duskfang'), normal('Grimtusk'), normal('Warhide'), normal('Ashclaw'),
      normal('Boneshard'), normal('Redtusk'), normal('Ironhide'), rare('Gorehorn'),
      normal('Blackfang'), normal('Stonehide'), normal('Duskclaw'), normal('Warfist'),
      rare('Ashtusk'), normal('Bonebrow'), normal('Grimfang'), normal('Skullhide')
    ]
  },
  {
    id: 'goliath',
    name: 'Goliath',
    firstNamesMale: [
      common('Kavaan'), common('Thurgo'), normal('Torvin'), normal('Halvor'),
      normal('Brolga'), normal('Draska'), normal('Kessil'), normal('Vrangar'),
      normal('Bjorund'), rare('Ormek'), normal('Skarvald'), normal('Rutger')
    ],
    firstNamesFemale: [
      common('Kaldra'), common('Vrenna'), normal('Ymira'), normal('Sunnva'),
      normal('Freyka'), normal('Astrun'), normal('Drovna'), normal('Kessa'),
      normal('Brenja'), rare('Vala'), normal('Skaldra'), normal('Rangva')
    ],
    firstNamesNeutral: [common('Vrik'), normal('Tuun'), normal('Skorn'), normal('Haan'), rare('Orvun')],
    lastNames: [
      common('Stonebreaker'), common('Cloudtop'), normal('Stormrender'), normal('Peakwalker'),
      normal('Frostbrow'), normal('Thunderfist'), normal('Duskcrest'), normal('Snowstride'),
      normal('Ironpeak'), normal('Skyrend'), normal('Stormcrest'), rare('Frostpeak'),
      normal('Cragstrider'), normal('Thunderpeak'), normal('Snowbrow'), normal('Stonecrest'),
      rare('Windpeak'), normal('Duskstrider'), normal('Frostrender'), normal('Cloudstrider')
    ]
  }
]

// Real-world naming-tradition sources a CUSTOM race can pool from instead of
// a baseline fantasy-race bank — inspired by fantasytowngenerator.com's
// multi-select name-source picker. List and scope confirmed with the user
// (see feedback_project_vault_no_campaign_content — the user supplies which
// categories exist, Claude builds the content within them). Each entry is
// its own single cohesive real-world naming tradition, so — unlike the
// deliberately-uniform-weight Human bank above, which mixes many traditions
// into one pool and would be skewed by weighting any of them — these DO use
// common/normal/rare weighting for in-tradition flavor, same as the 7
// fantasy race banks.
//
// NOT included: a "Native American" category. The user asked for one and
// pointed at two research sources; both that research and follow-up
// searches on specific nations (Diné/Navajo, Cherokee) turned up traditional
// given names described as ceremonial/sacred — reserved for spiritual
// contexts, not generic reuse — plus mostly low-quality, non-tribal-
// authored source material. Deliberately left out rather than built on a
// shaky research basis; revisit only with a specific nation + a source the
// user actually trusts (ideally tribal-authored).
export const NAME_INSPIRATION_SOURCES: NameBank[] = [
  {
    id: 'nordic',
    name: 'Nordic',
    firstNamesMale: [
      common('Erik'), common('Lars'), common('Magnus'), common('Anders'),
      normal('Sven'), normal('Bjorn'), normal('Nils'), normal('Gustav'),
      normal('Henrik'), normal('Fredrik'), normal('Olaf'), normal('Leif'),
      normal('Anton'), normal('Emil'), normal('Axel'), normal('Kasper'),
      normal('Aleksi'), rare('Sigurd'), rare('Viggo'), rare('Torbjorn')
    ],
    firstNamesFemale: [
      common('Astrid'), common('Ingrid'), common('Freya'), common('Elin'),
      normal('Karin'), normal('Liv'), normal('Maja'), normal('Signe'),
      normal('Ida'), normal('Linnea'), normal('Saga'), normal('Ronja'),
      normal('Vilma'), normal('Aino'), normal('Elsa'), normal('Thora'),
      normal('Hedda'), rare('Solveig'), rare('Kajsa'), rare('Gunhild')
    ],
    firstNamesNeutral: [common('Kim'), common('Noa'), normal('Eli'), normal('Sasha'), normal('Sol'), normal('Nova'), normal('Sami'), rare('Frey')],
    lastNames: [
      common('Andersen'), common('Nilsson'), common('Johansson'), common('Larsen'), common('Eriksen'),
      normal('Karlsson'), normal('Berg'), normal('Lindgren'), normal('Holm'), normal('Solberg'),
      normal('Fredriksen'), normal('Bakken'), normal('Haugen'), normal('Sandvik'), normal('Dahl'),
      normal('Lund'), normal('Nystrom'), normal('Rasmussen'), normal('Kristiansen'), normal('Virtanen'),
      rare('Myklebust'), rare('Viklund'), rare('Backlund'), rare('Halvorsen')
    ]
  },
  {
    id: 'romantic',
    name: 'Romantic (Italian / French / Portuguese / Spanish / Latin)',
    firstNamesMale: [
      common('Marco'), common('Luca'), common('Julien'), common('Carlos'), common('Diego'),
      normal('Matteo'), normal('Enzo'), normal('Dario'), normal('Théo'), normal('Antoine'),
      normal('Mathis'), normal('João'), normal('Tiago'), normal('Rafael'), normal('Bruno'),
      normal('Mateo'), normal('Emilio'), normal('Gabriel'), rare('Marcus'), rare('Augustus'), rare('Cassian')
    ],
    firstNamesFemale: [
      common('Giulia'), common('Chiara'), common('Camille'), common('Sofia'), common('Camila'),
      normal('Bianca'), normal('Alessia'), normal('Valentina'), normal('Margaux'), normal('Élodie'),
      normal('Léa'), normal('Beatriz'), normal('Mariana'), normal('Inês'), normal('Catarina'),
      normal('Lucía'), normal('Elena'), rare('Aurelia'), rare('Flavia'), rare('Livia')
    ],
    firstNamesNeutral: [common('Andrea'), common('Noel'), normal('Guadalupe'), normal('Ariel'), normal('Dominique'), normal('Simone'), normal('Rene'), rare('Nino')],
    lastNames: [
      common('Rossi'), common('Silva'), common('Rousseau'), common('Reyes'), common('Costa'),
      normal('Bianchi'), normal('Moretti'), normal('Ricci'), normal('Greco'), normal('Lavigne'),
      normal('Beaumont'), normal('Girard'), normal('Ferreira'), normal('Pereira'), normal('Carvalho'),
      normal('Morales'), normal('Castillo'), normal('Herrera'), normal('Vargas'),
      rare('Marino'), rare('Fontaine'), rare('Moreau'), rare('Nunes'), rare('Delgado')
    ]
  },
  {
    id: 'eastern-european',
    name: 'Eastern European',
    firstNamesMale: [
      common('Dmitri'), common('Ivan'), common('Tomasz'), common('Nikolai'),
      normal('Sergei'), normal('Pavel'), normal('Boris'), normal('Anton'), normal('Yuri'),
      normal('Oleg'), normal('Karol'), normal('Marek'), normal('Wojciech'), normal('Josef'),
      normal('Vaclav'), normal('Andriy'), normal('Taras'), normal('Istvan'),
      rare('Vlad'), rare('Radu')
    ],
    firstNamesFemale: [
      common('Olga'), common('Natasha'), common('Katarzyna'), common('Elena'),
      normal('Katarina'), normal('Nadia'), normal('Irina'), normal('Svetlana'), normal('Anya'),
      normal('Vera'), normal('Agnieszka'), normal('Zofia'), normal('Magda'), normal('Eliska'),
      normal('Tereza'), normal('Oksana'), normal('Yulia'), normal('Zsofia'),
      rare('Ilona'), rare('Ioana')
    ],
    firstNamesNeutral: [common('Sasha'), common('Zhenya'), normal('Valya'), normal('Nikita'), normal('Dana'), normal('Robin'), normal('Kai'), rare('Aleks')],
    lastNames: [
      common('Volkov'), common('Nowak'), common('Kowalski'), common('Petrov'), common('Novak'),
      normal('Sokolov'), normal('Ivanov'), normal('Dvorak'), normal('Kovac'), normal('Horvat'),
      normal('Nagy'), normal('Kovacs'), normal('Popescu'), normal('Ionescu'), normal('Kravets'),
      normal('Melnyk'), normal('Wojcik'), normal('Kaminski'), normal('Zielinski'),
      rare('Baranov'), rare('Smirnov'), rare('Kuznetsov'), rare('Nemec'), rare('Vaculik')
    ]
  },
  {
    id: 'east-asian',
    name: 'East Asian',
    firstNamesMale: [
      common('Wei'), common('Hao'), common('Haruto'), common('Ren'), common('Min-jun'),
      normal('Jian'), normal('Chen'), normal('Ming'), normal('Yong'), normal('Feng'),
      normal('Sora'), normal('Kenji'), normal('Daiki'), normal('Kaito'), normal('Seo-jun'),
      normal('Do-yoon'), normal('Jun-ho'), normal('Ji-ho'),
      rare('Temujin'), rare('Batbayar')
    ],
    firstNamesFemale: [
      common('Mei'), common('Ling'), common('Yuki'), common('Sakura'), common('Seo-yeon'),
      normal('Xia'), normal('Fang'), normal('Yan'), normal('Jing'), normal('Lan'),
      normal('Hana'), normal('Aoi'), normal('Yui'), normal('Rin'), normal('Ji-woo'),
      normal('Min-seo'), normal('Ha-eun'), normal('Soo-ah'),
      rare('Altantsetseg'), rare('Sarnai')
    ],
    firstNamesNeutral: [common('Yu'), common('Jin'), normal('Xin'), normal('Hikaru'), normal('Eun'), normal('Nari'), normal('Kyo'), rare('Bat')],
    lastNames: [
      common('Wang'), common('Li'), common('Kim'), common('Tanaka'), common('Lee'),
      normal('Zhang'), normal('Chen'), normal('Liu'), normal('Yang'), normal('Suzuki'),
      normal('Sato'), normal('Watanabe'), normal('Yamamoto'), normal('Nakamura'), normal('Park'),
      normal('Choi'), normal('Jung'), normal('Kang'),
      rare('Batbold'), rare('Ganbaatar'), rare('Dorj'), rare('Tsend'), rare('Erdene'), rare('Sukhbaatar')
    ]
  },
  {
    id: 'south-asian',
    name: 'South Asian',
    firstNamesMale: [
      common('Arjun'), common('Ravi'), common('Aarav'), common('Rohan'), common('Ahmed'),
      normal('Vikram'), normal('Rajesh'), normal('Suresh'), normal('Harpreet'), normal('Jaspreet'),
      normal('Gurpreet'), normal('Karthik'), normal('Arun'), normal('Vijay'), normal('Senthil'),
      normal('Debashish'), normal('Anirban'), normal('Rahul'),
      rare('Imran'), rare('Farhan')
    ],
    firstNamesFemale: [
      common('Aditi'), common('Priya'), common('Ananya'), common('Kavya'), common('Ayesha'),
      normal('Neha'), normal('Pooja'), normal('Anjali'), normal('Simran'), normal('Amandeep'),
      normal('Harleen'), normal('Meena'), normal('Divya'), normal('Lakshmi'), normal('Kavitha'),
      normal('Priyanka'), normal('Ritu'), normal('Anika'),
      rare('Zara'), rare('Sana')
    ],
    firstNamesNeutral: [common('Kiran'), common('Preet'), normal('Amrit'), normal('Deep'), normal('Chand'), normal('Nur'), normal('Arya'), rare('Sunny')],
    lastNames: [
      common('Sharma'), common('Singh'), common('Khan'), common('Patel'), common('Kaur'),
      normal('Verma'), normal('Gupta'), normal('Mehta'), normal('Joshi'), normal('Rao'),
      normal('Gill'), normal('Dhillon'), normal('Pillai'), normal('Iyer'), normal('Raman'),
      normal('Krishnan'), normal('Chatterjee'), normal('Banerjee'),
      rare('Sengupta'), rare('Das'), rare('Malik'), rare('Qureshi'), rare('Siddiqui'), rare('Chaudhry')
    ]
  },
  {
    id: 'west-asian',
    name: 'West Asian (Turkish / Persian / Armenian / Georgian / Azerbaijani / Kurdish / Hebrew)',
    firstNamesMale: [
      common('Mehmet'), common('Emre'), common('Cyrus'), common('Darius'), common('Ari'),
      normal('Kaan'), normal('Baris'), normal('Farhan'), normal('Kian'), normal('Armen'),
      normal('Vahan'), normal('Tigran'), normal('Giorgi'), normal('Levan'), normal('Luka'),
      normal('Elvin'), normal('Tural'), normal('Rojhat'),
      rare('Diyar'), rare('Noam')
    ],
    firstNamesFemale: [
      common('Elif'), common('Ayse'), common('Roxana'), common('Yasmin'), common('Maya'),
      normal('Ece'), normal('Zeynep'), normal('Neda'), normal('Shirin'), normal('Ani'),
      normal('Lusine'), normal('Nare'), normal('Nino'), normal('Tamar'), normal('Salome'),
      normal('Aysel'), normal('Nigar'), normal('Berivan'),
      rare('Rojin'), rare('Talia')
    ],
    firstNamesNeutral: [common('Deniz'), common('Tal'), normal('Sahar'), normal('Baran'), normal('Or'), normal('Aras'), normal('Sina'), rare('Roya')],
    lastNames: [
      common('Yilmaz'), common('Cohen'), common('Aliyev'), common('Hosseini'), common('Petrosyan'),
      normal('Kaya'), normal('Demir'), normal('Aydin'), normal('Rostami'), normal('Karimi'),
      normal('Ahmadi'), normal('Sarkisyan'), normal('Grigoryan'), normal('Avetisyan'), normal('Beridze'),
      normal('Gelashvili'), normal('Mammadov'), normal('Huseynov'),
      rare('Tsereteli'), rare('Abashidze'), rare('Ismayilov'), rare('Levi'), rare('Rashid'), rare('Amedi')
    ]
  },
  {
    id: 'north-african-middle-eastern',
    name: 'North African / Middle Eastern',
    firstNamesMale: [
      common('Omar'), common('Yusuf'), common('Tariq'), common('Khalid'), common('Hassan'),
      normal('Karim'), normal('Ali'), normal('Amir'), normal('Samir'), normal('Rashid'),
      normal('Nasser'), normal('Mostafa'), normal('Hamza'), normal('Anis'), normal('Sami'),
      normal('Faisal'), normal('Bilal'), normal('Zayd'),
      rare('Idris'), rare('Malik')
    ],
    firstNamesFemale: [
      common('Fatima'), common('Layla'), common('Amira'), common('Yasmin'), common('Noor'),
      normal('Salma'), normal('Huda'), normal('Rania'), normal('Dalia'), normal('Zainab'),
      normal('Aisha'), normal('Hana'), normal('Mariam'), normal('Sara'), normal('Nadia'),
      normal('Samira'), normal('Iman'), normal('Farida'),
      rare('Widad'), rare('Basma')
    ],
    firstNamesNeutral: [common('Nour'), common('Amal'), normal('Karam'), normal('Salam'), normal('Hilal'), normal('Rayan'), normal('Amin'), rare('Sena')],
    lastNames: [
      common('Haddad'), common('Khalil'), common('Mansour'), common('Saleh'), common('Aziz'),
      normal('Farouk'), normal('Rahman'), normal('Fahmy'), normal('Sabbagh'), normal('Najjar'),
      normal('Khoury'), normal('Barakat'), normal('Hakim'), normal('Idrissi'), normal('Benali'),
      normal('Cherkaoui'), normal('Amrani'), normal('Younes'),
      rare('Ziani'), rare('Bouzid'), rare('Selmani'), rare('Kassab'), rare('Deeb'), rare('Antar')
    ]
  },
  {
    id: 'central-african',
    name: 'Central African',
    firstNamesMale: [
      common('Emmanuel'), common('Patrice'), common('Serge'), common('Guy'), common('Blaise'),
      normal('Baraka'), normal('Jelani'), normal('Kito'), normal('Sefu'), normal('Tau'),
      normal('Zuberi'), normal('Bakari'), normal('Dieudonné'), normal('Innocent'), normal('Aime'),
      normal('Faustin'), normal('Bienvenu'), normal('Franck'),
      rare('Yannick'), rare('Junior')
    ],
    firstNamesFemale: [
      common('Grace'), common('Chantal'), common('Josephine'), common('Divine'), common('Solange'),
      normal('Amani'), normal('Neema'), normal('Furaha'), normal('Malaika'), normal('Zawadi'),
      normal('Bahati'), normal('Nzuzi'), normal('Kavira'), normal('Mwamini'), normal('Espoir'),
      normal('Bernadette'), normal('Odile'), normal('Clarisse'),
      rare('Aline'), rare('Prisca')
    ],
    firstNamesNeutral: [common('Amani'), common('Divine'), normal('Baraka'), normal('Tumaini'), normal('Nsuka'), normal('Kanku'), normal('Doudou'), rare('Junior')],
    lastNames: [
      common('Mabiala'), common('Ilunga'), common('Ngoma'), common('Kasongo'), common('Mukendi'),
      normal('Nzeza'), normal('Mulumba'), normal('Kanyinda'), normal('Tshibangu'), normal('Kabongo'),
      normal('Mwepu'), normal('Bemba'), normal('Moukoko'), normal('Ondo'), normal('Eyenga'),
      normal('Ekwalla'), normal('Assam'), normal('Ateba'),
      rare('Mbida'), rare('Ngono'), rare('Zang'), rare('Owona'), rare('Fouda'), rare('Essomba')
    ]
  },
  {
    id: 'south-african',
    name: 'South African',
    firstNamesMale: [
      common('Sipho'), common('Themba'), common('Thabo'), common('Pieter'), common('Lucky'),
      normal('Mandla'), normal('Bongani'), normal('Sizwe'), normal('Kgosi'), normal('Tumelo'),
      normal('Kabelo'), normal('Tebogo'), normal('Jaco'), normal('Willem'), normal('Hendrik'),
      normal('Lwazi'), normal('Nkosana'), normal('Vusi'),
      rare('Sanele'), rare('Andile')
    ],
    firstNamesFemale: [
      common('Nomvula'), common('Thandiwe'), common('Lerato'), common('Precious'), common('Blessing'),
      normal('Zanele'), normal('Ntombi'), normal('Nokuthula'), normal('Lindiwe'), normal('Palesa'),
      normal('Refilwe'), normal('Dineo'), normal('Anneke'), normal('Susara'), normal('Marietjie'),
      normal('Elsabe'), normal('Zodwa'), normal('Bongiwe'),
      rare('Nomsa'), rare('Khanyisile')
    ],
    firstNamesNeutral: [common('Karabo'), common('Neo'), normal('Lesedi'), normal('Reitumetse'), normal('Kagiso'), normal('Onalenna'), normal('Ayanda'), rare('Bontle')],
    lastNames: [
      common('Dlamini'), common('Ndlovu'), common('Khumalo'), common('Nkosi'), common('Botha'),
      normal('Mahlangu'), normal('Sithole'), normal('Zulu'), normal('Molefe'), normal('Mokoena'),
      normal('Motaung'), normal('Sebe'), normal('van der Merwe'), normal('du Plessis'), normal('Pretorius'),
      normal('Fourie'), normal('Mabaso'), normal('Radebe'),
      rare('Naude'), rare('Mthembu'), rare('Skosana'), rare('Baloyi'), rare('Chiweshe'), rare('Moyo')
    ]
  }
]

// Used when a race id resolves to neither a baseline bank nor a custom race
// with any inspiration sources selected yet — keeps generation from ever
// crashing on an unconfigured race, at the cost of obviously-generic output.
const FALLBACK_NAME_BANK: NameBank = {
  id: 'generic',
  name: 'Generic',
  firstNamesMale: [normal('Ash'), normal('Brin'), normal('Cael'), normal('Del')],
  firstNamesFemale: [normal('Ero'), normal('Fen'), normal('Gale'), normal('Hollis')],
  firstNamesNeutral: [normal('Vale'), normal('Marsh')],
  lastNames: [normal('Thorn'), normal('Cross'), normal('Wood'), normal('Hale')]
}

/** Finds the right name pool for a race id: baseline bank, else a custom race's pooled inspiration sources, else a generic fallback. */
export function resolveNameBank(
  raceId: string,
  customRaces: CustomRaceDef[] = [],
  inspirationSources: NameBank[] = NAME_INSPIRATION_SOURCES
): NameBank {
  const baseline = BASELINE_NAME_BANKS.find((bank) => bank.id === raceId)
  if (baseline) return baseline

  const custom = customRaces.find((race) => race.id === raceId)
  if (custom) {
    const sources = inspirationSources.filter((source) => custom.inspirationSourceIds.includes(source.id))
    if (sources.length > 0) {
      return {
        id: custom.id,
        name: custom.name,
        firstNamesMale: sources.flatMap((source) => source.firstNamesMale),
        firstNamesFemale: sources.flatMap((source) => source.firstNamesFemale),
        firstNamesNeutral: sources.flatMap((source) => source.firstNamesNeutral),
        lastNames: sources.flatMap((source) => source.lastNames)
      }
    }
  }

  return FALLBACK_NAME_BANK
}

// Male/Female draw from their own pool plus the bank's unisex pool; any
// other gender string (Nonbinary, or a custom value someone typed) draws
// from all three pools combined — more variety, not less, for residents
// outside the binary rather than limiting them to just the (smallest) pool.
function genderPool(bank: NameBank, gender: string): WeightedName[] {
  if (gender === 'Male') return [...bank.firstNamesMale, ...bank.firstNamesNeutral]
  if (gender === 'Female') return [...bank.firstNamesFemale, ...bank.firstNamesNeutral]
  return [...bank.firstNamesMale, ...bank.firstNamesFemale, ...bank.firstNamesNeutral]
}

export function generateName(bank: NameBank, gender: string, rng: () => number = Math.random): string {
  const first = pickWeighted(genderPool(bank, gender), rng)?.name ?? 'Unnamed'
  const last = pickWeighted(bank.lastNames, rng)
  return last ? `${first} ${last.name}` : first
}

// Personality/goal for a notable (staffed-building resident) are combined
// from two small building-block pools rather than a flat list of
// pre-written personalities — keeps variety high from a small seed set.
export const NOTABLE_TRAITS: string[] = [
  'Gruff but fair',
  'Warm and talkative',
  'Sharp-tongued and impatient',
  'Quiet and watchful',
  'Endlessly cheerful',
  'Shrewd and calculating',
  'Superstitious to a fault',
  'Blunt, sometimes to a fault',
  'Generous with regulars, wary of strangers',
  'Proud of their craft above all else',
  'Nervous around authority',
  'Slow to trust, loyal once earned',
  'Loud, opinionated, hard to ignore',
  'Soft-spoken but sharp-eyed',
  'Ambitious beyond their station'
]

export const NOTABLE_GOALS: string[] = [
  'wants to expand the business, whatever it takes',
  'is quietly saving to leave town for good',
  'wants their child to inherit something better than they had',
  'is hiding a debt they can\'t repay',
  'wants respect they feel they\'ve never gotten',
  'is looking for a missing family member',
  'wants to be the first person others turn to in town',
  'is trying to outlast a rival across town',
  'wants to retire, but no one else can take over',
  'is protecting a secret from their past',
  'wants recognition from the local authority',
  'is trying to pay off the building\'s old debts',
  'wants a quiet life and keeps getting pulled into town business anyway',
  'is grooming an apprentice to take over',
  'wants to be left alone, mostly'
]

export function generatePersonalityLine(rng: () => number = Math.random): string {
  return NOTABLE_TRAITS[Math.floor(rng() * NOTABLE_TRAITS.length)]
}

export function generateGoal(rng: () => number = Math.random): string {
  return NOTABLE_GOALS[Math.floor(rng() * NOTABLE_GOALS.length)]
}

// One-line flavor for non-notable (stub) residents — cheaper than a full
// personality/goal, but enough to make a household list feel populated
// rather than a wall of identical blank names.
export const FLAVOR_TAG_TEMPLATES: string[] = [
  'Whistles constantly, off-key.',
  'Owes someone in town a favor.',
  'Collects odd trinkets from travelers.',
  'Superstitious about the number thirteen.',
  'Known for a suspiciously green thumb.',
  "Hasn't missed a market day in years.",
  'Quick with a rumor, slow with the truth.',
  'Keeps a lucky charm on a cord around their neck.',
  'Fiercely proud of a mediocre vegetable garden.',
  'Always the first to volunteer, rarely finishes the job.',
  'Distrustful of anyone not born in town.',
  'Sings to the animals; swears it helps.',
  'Never talks about where they came from.',
  "Saving up for something they won't name.",
  "The town's unofficial keeper of gossip.",
  'Surprisingly good at cards.',
  'Afraid of open water.',
  'Wears the same hat every single day.',
  'Feeds every stray that wanders through.',
  'Owes their trade to a parent who taught them everything.'
]

export function generateFlavorTag(rng: () => number = Math.random): string {
  return FLAVOR_TAG_TEMPLATES[Math.floor(rng() * FLAVOR_TAG_TEMPLATES.length)]
}
