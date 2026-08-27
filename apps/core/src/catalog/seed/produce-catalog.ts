import type {
  ProduceBaseUnit,
  ProduceCategoryCode,
  ProduceCatalogSummary,
  ProduceMerchandisingLabel,
  ProduceSeedDetail,
  ProduceSeedProduct,
  ProduceSeedVariant,
} from "./produce-catalog-types";

/**
 * The complete development-time produce seed manifest: one reviewable entry
 * per public asset under apps/web/public/produce. This is seed input for the
 * deterministic migration generator, never a runtime catalog authority.
 *
 * Money is positive integer PHP centavos. Base quantities are exact positive
 * integers in GRAM or PIECE. Pack/Bunch labels carry approximate customer
 * notes plus exact internal gram recipes and staff packing instructions;
 * operations instructions stay server-side.
 */

/** Reference price in centavos per kilogram used for fixed weight derivations. */
type RefPriceMinor = number;

function codeFor(slug: string): string {
  return slug.toUpperCase().replace(/-/g, "_");
}

function roundToLaunchIncrement(minor: number): number {
  // Sensible fifty-centavo increments with a ₱20 launch floor.
  return Math.max(2000, Math.round(minor / 50) * 50);
}

function weightVariants(
  slug: string,
  refPerKgMinor: RefPriceMinor,
  gramSizes: ReadonlyArray<number> = [250, 500, 1000],
): ProduceSeedVariant[] {
  return gramSizes.map((grams, index) => {
    const kilo = grams >= 1000;
    return {
      id: `sku-${slug}-${kilo ? "1kg" : `${grams}g`}`,
      code: `${codeFor(slug)}_${kilo ? "1KG" : `${grams}G`}`,
      displayName: kilo ? "1 kg" : `${grams} g`,
      baseUnit: "GRAM" as const,
      sellUnitCode: kilo ? ("KG" as const) : ("G" as const),
      sellQuantity: kilo ? 1 : grams,
      inventoryQuantityBase: grams,
      priceMinor: roundToLaunchIncrement(Math.round((refPerKgMinor * grams) / 1000)),
      sortOrder: index + 1,
    };
  });
}

function pieceVariants(
  slug: string,
  pieces: ReadonlyArray<{ count?: number; priceMinor: number }>,
): ProduceSeedVariant[] {
  return pieces.map((piece, index) => {
    const count = piece.count ?? 1;
    const label = count === 1 ? "1 piece" : `${count} pieces`;
    return {
      id: `sku-${slug}-${count === 1 ? "1pc" : `${count}pc`}`,
      code: `${codeFor(slug)}_${count === 1 ? "1PC" : `${count}PC`}`,
      displayName: label,
      baseUnit: "PIECE" as const,
      sellUnitCode: "PC" as const,
      sellQuantity: count,
      inventoryQuantityBase: count,
      priceMinor: piece.priceMinor,
      sortOrder: index + 1,
    };
  });
}

/**
 * Staff-assembled pack/bunch: customer buys one labeled pack; Core keeps the
 * exact gram recipe and the packing instruction server-side.
 */
function packVariant(
  slug: string,
  options: {
    grams: number;
    bunch?: boolean;
    priceMinor: number;
    note: string;
    ops?: string;
  },
): ProduceSeedVariant {
  const label: ProduceMerchandisingLabel = options.bunch ? "Bunch" : "Pack";
  return {
    id: `sku-${slug}-${options.bunch ? "bunch" : "pack"}`,
    code: `${codeFor(slug)}_${options.bunch ? "BUNCH" : "PACK"}`,
    displayName: options.bunch ? "1 bunch" : "1 pack",
    merchandisingLabel: label,
    baseUnit: "GRAM",
    sellUnitCode: "G",
    sellQuantity: options.grams,
    inventoryQuantityBase: options.grams,
    customerContentsNote: options.note,
    packingInstruction: options.ops ?? `Pack ${options.grams} g per bag.`,
    priceMinor: options.priceMinor,
    sortOrder: 1,
  };
}

const STORAGE = {
  leafy: "Keep refrigerated in a breathable bag and use within two to three days.",
  fruitRoom:
    "Ripen at room temperature until fragrant, then refrigerate and enjoy within a few days.",
  fruitChill: "Keep refrigerated and consume within a few days of purchase.",
  root: "Store in a cool, dry, well-ventilated place away from direct sunlight.",
  beans: "Store in a sealed container in a cool, dry place.",
  chill: "Keep refrigerated and use soon after purchase.",
} as const;

type StorageKey = keyof typeof STORAGE;

function detailRows(
  variants: ReadonlyArray<ProduceSeedVariant>,
  storage: StorageKey,
  contentsLead: string,
): ProduceSeedDetail[] {
  const sizeWords = variants.map((variant) => variant.displayName);
  return [
    {
      label: "Contents",
      value: `${contentsLead} Fixed sizes: ${sizeWords.join(", ")}.`,
      sortOrder: 1,
    },
    { label: "Storage", value: STORAGE[storage], sortOrder: 2 },
  ];
}

function fp(input: {
  slug: string;
  name: string;
  categoryCode: ProduceCategoryCode;
  description: string;
  storageKey: StorageKey;
  inventoryBaseUnit: ProduceBaseUnit;
  variants: ProduceSeedVariant[];
  assetKey?: string;
  altText?: string;
  contentsLead?: string;
}): ProduceSeedProduct {
  const id = `product-${input.slug}`;
  const assetKey = input.assetKey ?? `${input.slug}.webp`;
  return {
    id,
    slug: input.slug,
    name: input.name,
    categoryCode: input.categoryCode,
    description: input.description,
    media: { assetKey, altText: input.altText ?? `${input.name} — fresh market produce photo` },
    details: detailRows(
      input.variants,
      input.storageKey,
      input.contentsLead ?? "Sold in fixed store-packed sizes.",
    ),
    inventoryBaseUnit: input.inventoryBaseUnit,
    variants: [...input.variants].sort((left, right) => left.sortOrder - right.sortOrder),
  };
}

/* ------------------------------------------------------------------ */
/* Fruits                                                              */
/* ------------------------------------------------------------------ */

const FRUITS: ProduceSeedProduct[] = [
  fp({ slug: "abiu", name: "Abiu", categoryCode: "FRUITS", description: "A pale golden tropical fruit with translucent sweet pulp, eaten fresh when fully ripe.", storageKey: "fruitRoom", inventoryBaseUnit: "PIECE", variants: pieceVariants("abiu", [{ priceMinor: 8500 }]) }),
  fp({ slug: "anonas", name: "Anonas", categoryCode: "FRUITS", description: "A scaly custard apple relative with creamy white flesh around dark seeds.", storageKey: "fruitRoom", inventoryBaseUnit: "PIECE", variants: pieceVariants("anonas", [{ priceMinor: 9500 }]) }),
  fp({ slug: "aratiles-manzanita", name: "Aratiles (Manzanita)", categoryCode: "FRUITS", description: "Small cherry-like tree fruits with light sweetness, commonly eaten straight from the basket.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("aratiles-manzanita", { grams: 250, priceMinor: 5000, note: "Approximately 40–60 aratiles berries per packed cup." })], contentsLead: "Hand-filled berry cups." }),
  fp({ slug: "aruas-fruits", name: "Aruas Fruits", categoryCode: "FRUITS", description: "Wild riverbank berries gathered seasonally in the Visayas, mildly sweet when deep purple.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("aruas-fruits", { grams: 250, priceMinor: 4000, note: "A loose 250 g cup of seasonal berries." })], contentsLead: "Seasonal wild berries." }),
  fp({ slug: "atis", name: "Atis (Sugar Apple)", categoryCode: "FRUITS", description: "Knobby green sugar apple with custardy segments of sweet white flesh.", storageKey: "fruitRoom", inventoryBaseUnit: "PIECE", variants: pieceVariants("atis", [{ priceMinor: 8500 }]) }),
  fp({ slug: "avocado", name: "Creamy Avocado", categoryCode: "FRUITS", description: "Rich avocados selected for salads, toast, and smoothies.", storageKey: "fruitRoom", inventoryBaseUnit: "GRAM", variants: weightVariants("avocado", 18900) }),
  fp({ slug: "balimbing", name: "Balimbing (Star Fruit)", categoryCode: "FRUITS", description: "Crisp five-ridged fruit that slices into star shapes, tangy-sweet when fully yellow.", storageKey: "fruitChill", inventoryBaseUnit: "PIECE", variants: pieceVariants("balimbing", [{ priceMinor: 3500 }]) }),
  fp({ slug: "banana", name: "Local Bananas", categoryCode: "FRUITS", description: "Everyday Filipino cooking-and-eating bananas from mixed local varieties.", storageKey: "fruitRoom", inventoryBaseUnit: "GRAM", variants: weightVariants("banana", 9500) }),
  fp({ slug: "banana-bungulan", name: "Bungulan Bananas", categoryCode: "FRUITS", description: "Bright green bananas with firm, gently acidic sweetness popular for eating fresh.", storageKey: "fruitRoom", inventoryBaseUnit: "GRAM", variants: weightVariants("banana-bungulan", 11000) }),
  fp({ slug: "banana-cavendish", name: "Cavendish Bananas", categoryCode: "FRUITS", description: "Uniform dessert bananas with mild creamy flesh, familiar from plantation packing.", storageKey: "fruitRoom", inventoryBaseUnit: "GRAM", variants: weightVariants("banana-cavendish", 12000) }),
  fp({ slug: "banana-lakatan", name: "Lakatan Bananas", categoryCode: "FRUITS", description: "Sweet, fragrant Lakatan bananas packed at an everyday family size.", storageKey: "fruitRoom", inventoryBaseUnit: "GRAM", variants: weightVariants("banana-lakatan", 14700) }),
  fp({ slug: "banana-latundan", name: "Latundan Bananas", categoryCode: "FRUITS", description: "Slender bananas with soft apple-toned sweetness, a common table variety.", storageKey: "fruitRoom", inventoryBaseUnit: "GRAM", variants: weightVariants("banana-latundan", 10500) }),
  fp({ slug: "banana-other-varieties", name: "Bananas (Other Varieties)", categoryCode: "FRUITS", description: "Rotating smaller banana varieties offered as available through the week.", storageKey: "fruitRoom", inventoryBaseUnit: "GRAM", variants: weightVariants("banana-other-varieties", 9000) }),
  fp({ slug: "banana-saba", name: "Saba Bananas", categoryCode: "FRUITS", description: "Stout cooking bananas for nilaga, banana cue, turrón, and boil-then-fry dishes.", storageKey: "fruitRoom", inventoryBaseUnit: "GRAM", variants: weightVariants("banana-saba", 8000) }),
  fp({ slug: "bignay", name: "Bignay Berries", categoryCode: "FRUITS", description: "Tiny currant-style berries that darken from amber to near black with tart depth.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("bignay", { grams: 250, priceMinor: 4500, note: "Hundreds of tiny berries fill one 250 g cup." })], contentsLead: "Loose berry cups." }),
  fp({ slug: "breadfruit", name: "Breadfruit (Rimas)", categoryCode: "FRUITS", description: "Pale green breadfruit with starchy cream-colored flesh for simmering and frying.", storageKey: "fruitChill", inventoryBaseUnit: "PIECE", variants: pieceVariants("breadfruit", [{ priceMinor: 6500 }]) }),
  fp({ slug: "calamansi", name: "Calamansi", categoryCode: "FRUITS", description: "Bright local citrus for drinks, sauces, and marinades.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("calamansi", 11900) }),
  fp({ slug: "camachile", name: "Camachile", categoryCode: "FRUITS", description: "Twisted seed pods with sweet pinkish edible flesh around hard seeds, eaten like tamarind snacks.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("camachile", 10000, [500]) }),
  fp({ slug: "canistel", name: "Canistel (Chesa)", categoryCode: "FRUITS", description: "Egg-shaped fruit with dense pumpkin-orange flesh tasting of sweet roasted squash.", storageKey: "fruitRoom", inventoryBaseUnit: "GRAM", variants: weightVariants("canistel", 10000) }),
  fp({ slug: "chico", name: "Chico", categoryCode: "FRUITS", description: "Brown-skinned sapodilla with grainy caramel-sweet flesh when pressed gently at the shoulders.", storageKey: "fruitRoom", inventoryBaseUnit: "GRAM", variants: weightVariants("chico", 13000) }),
  fp({ slug: "dalandan", name: "Dalandan", categoryCode: "FRUITS", description: "Filipino sweet-orange fruit for juicing and fresh segments.", storageKey: "fruitChill", inventoryBaseUnit: "GRAM", variants: weightVariants("dalandan", 13000) }),
  fp({ slug: "dragon-fruit", name: "Dragon Fruit", categoryCode: "FRUITS", description: "Vivid magenta cactus fruit speckled with black seeds and mildly sweet white flesh.", storageKey: "fruitChill", inventoryBaseUnit: "PIECE", variants: pieceVariants("dragon-fruit", [{ priceMinor: 12500 }]) }),
  fp({ slug: "duhat", name: "Duhat", categoryCode: "FRUITS", description: "Deep purple Java plum clusters with winey sweetness shaken from the branch each season.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("duhat", 9000) }),
  fp({ slug: "durian", name: "Durian", categoryCode: "FRUITS", description: "Spiked aromatic durian sold whole and priced per piece, ready when the seams begin to part.", storageKey: "fruitRoom", inventoryBaseUnit: "PIECE", variants: pieceVariants("durian", [{ priceMinor: 28000 }]) }),
  fp({ slug: "golden-melon", name: "Golden Melon", categoryCode: "FRUITS", description: "Yellow-rind melon with pale green juicy flesh for chilled serving.", storageKey: "fruitChill", inventoryBaseUnit: "PIECE", variants: pieceVariants("golden-melon", [{ priceMinor: 9500 }]) }),
  fp({ slug: "granada-pomegranate", name: "Pomegranate", categoryCode: "FRUITS", description: "Imported pomegranates heavy with ruby juice sacs, snapped open over a bowl.", storageKey: "fruitChill", inventoryBaseUnit: "PIECE", variants: pieceVariants("granada-pomegranate", [{ priceMinor: 14900 }]) }),
  fp({ slug: "grapes", name: "Grapes", categoryCode: "FRUITS", description: "Table grapes in rotating red and green selections, washed chilled and served straight.", storageKey: "fruitChill", inventoryBaseUnit: "GRAM", variants: weightVariants("grapes", 25000) }),
  fp({ slug: "grapes-green", name: "Green Grapes", categoryCode: "FRUITS", description: "Crisp green seedless-style table grapes with a bright snap.", storageKey: "fruitChill", inventoryBaseUnit: "GRAM", variants: weightVariants("grapes-green", 28000) }),
  fp({ slug: "grapes-red", name: "Red Grapes", categoryCode: "FRUITS", description: "Sweet red table grapes with firm skins and floral juice.", storageKey: "fruitChill", inventoryBaseUnit: "GRAM", variants: weightVariants("grapes-red", 30000) }),
  fp({ slug: "guava", name: "Guava", categoryCode: "FRUITS", description: "Everyday guavas for eating raw with salt or simmering into jam.", storageKey: "fruitRoom", inventoryBaseUnit: "GRAM", variants: weightVariants("guava", 9000) }),
  fp({ slug: "guava-guapple", name: "Guapple Guava", categoryCode: "FRUITS", description: "Large apple-sized guava with thick crisp white flesh and few seeds.", storageKey: "fruitRoom", inventoryBaseUnit: "GRAM", variants: weightVariants("guava-guapple", 13000) }),
  fp({ slug: "guava-native", name: "Native Guava", categoryCode: "FRUITS", description: "Small fragrant native guavas with rosy skin, nostalgic dipped in rock salt.", storageKey: "fruitRoom", inventoryBaseUnit: "GRAM", variants: weightVariants("guava-native", 10000) }),
  fp({ slug: "guyabano", name: "Guyabano (Soursop)", categoryCode: "FRUITS", description: "Soft-spined green fruit with fibrous tart-sweet pulp prized for shakes.", storageKey: "fruitRoom", inventoryBaseUnit: "PIECE", variants: pieceVariants("guyabano", [{ priceMinor: 12500 }]) }),
  fp({ slug: "jackfruit-ripe", name: "Ripe Jackfruit", categoryCode: "FRUITS", description: "Golden ripe langka sections with dense tropical aroma and chewy sweetness.", storageKey: "fruitChill", inventoryBaseUnit: "PIECE", variants: pieceVariants("jackfruit-ripe", [{ priceMinor: 18000 }]) }),
  fp({ slug: "kalumpit", name: "Kalumpit Berries", categoryCode: "FRUITS", description: "Small dark cherries from Mindanao trees, sweet-tart and sold while they last.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("kalumpit", { grams: 250, priceMinor: 4500, note: "A generous seasonal cup of kalumpit." })], contentsLead: "Seasonal berry cups." }),
  fp({ slug: "lanzones", name: "Lanzones", categoryCode: "FRUITS", description: "Pale transluscent peeled segments with milky sweetness, best in peak season.", storageKey: "fruitChill", inventoryBaseUnit: "GRAM", variants: weightVariants("lanzones", 26000) }),
  fp({ slug: "lemon", name: "Lemon", categoryCode: "FRUITS", description: "Imported lemons for dressings, hot drinks, and baking.", storageKey: "fruitChill", inventoryBaseUnit: "GRAM", variants: weightVariants("lemon", 32000) }),
  fp({ slug: "lime", name: "Lime (Dayap)", categoryCode: "FRUITS", description: "Fragrant green dayap limes sharper than calamansi for desserts and drinks.", storageKey: "fruitChill", inventoryBaseUnit: "GRAM", variants: weightVariants("lime", 14000) }),
  fp({ slug: "longan", name: "Longan", categoryCode: "FRUITS", description: "Peel-away tan shells revealing translucent dragon-eye fruit with honeyed grape flavor.", storageKey: "fruitChill", inventoryBaseUnit: "GRAM", variants: weightVariants("longan", 38000, [250, 500]) }),
  fp({ slug: "mabolo", name: "Mabolo (Velvet Apple)", categoryCode: "FRUITS", description: "Velvety rust-colored apple-shaped fruit with firm pale interior, skinned before eating.", storageKey: "fruitRoom", inventoryBaseUnit: "PIECE", variants: pieceVariants("mabolo", [{ priceMinor: 6500 }]) }),
  fp({ slug: "makopa", name: "Makopa (Macopa)", categoryCode: "FRUITS", description: "Bell-shaped rose-red fruit with crisp watery cotton-candy crunch.", storageKey: "fruitChill", inventoryBaseUnit: "GRAM", variants: weightVariants("makopa", 11000) }),
  fp({ slug: "mandarin", name: "Mandarin Oranges", categoryCode: "FRUITS", description: "Easy-peel mandarins for lunchboxes and fresh segments.", storageKey: "fruitChill", inventoryBaseUnit: "GRAM", variants: weightVariants("mandarin", 20000) }),
  fp({ slug: "mango", name: "Mangoes", categoryCode: "FRUITS", description: "Mixed everyday Philippine mangoes offered by weight across the season.", storageKey: "fruitRoom", inventoryBaseUnit: "GRAM", variants: weightVariants("mango", 16000) }),
  fp({ slug: "mango-carabao", name: "Carabao Mangoes", categoryCode: "FRUITS", description: "Golden Philippine mangoes with a bright aroma and smooth sweetness.", storageKey: "fruitRoom", inventoryBaseUnit: "GRAM", variants: weightVariants("mango-carabao", 23800) }),
  fp({ slug: "mango-indian", name: "Indian Mangoes", categoryCode: "FRUITS", description: "Small green-yellow mangoes with sharp tangy flesh loved with bagoong.", storageKey: "fruitRoom", inventoryBaseUnit: "GRAM", variants: weightVariants("mango-indian", 30000) }),
  fp({ slug: "mango-other-varieties", name: "Mangoes (Other Varieties)", categoryCode: "FRUITS", description: "Rotating regional mango varieties as harvests move island to island.", storageKey: "fruitRoom", inventoryBaseUnit: "GRAM", variants: weightVariants("mango-other-varieties", 18000) }),
  fp({ slug: "mango-piko", name: "Piko Mangoes", categoryCode: "FRUITS", description: "Tart-to-sweet elongated mangoes enjoyed half-green with dip or fully ripened.", storageKey: "fruitRoom", inventoryBaseUnit: "GRAM", variants: weightVariants("mango-piko", 19000) }),
  fp({ slug: "mangosteen", name: "Mangosteen", categoryCode: "FRUITS", description: "Thick purple husks opening to snow-white segmented crowns of delicate citrus-vanilla flesh.", storageKey: "fruitChill", inventoryBaseUnit: "GRAM", variants: weightVariants("mangosteen", 36000, [250, 500]) }),
  fp({ slug: "manguelas-june-plum", name: "June Plum (Manguelas)", categoryCode: "FRUITS", description: "Crisp golden plum-sized fruit rolled in salt for a tart crunchy snack.", storageKey: "fruitChill", inventoryBaseUnit: "PIECE", variants: pieceVariants("manguelas-june-plum", [{ priceMinor: 4000 }, { count: 5, priceMinor: 18000 }]) }),
  fp({ slug: "marang", name: "Marang", categoryCode: "FRUITS", description: "Mindanao treasure fruit whose thick rind opens to creamy custard-like white petals.", storageKey: "fruitRoom", inventoryBaseUnit: "PIECE", variants: pieceVariants("marang", [{ priceMinor: 11000 }]) }),
  fp({ slug: "melon", name: "Melon", categoryCode: "FRUITS", description: "Netted cantaloupe-style melon scooped into balls or chilled wedges.", storageKey: "fruitChill", inventoryBaseUnit: "PIECE", variants: pieceVariants("melon", [{ priceMinor: 8500 }]) }),
  fp({ slug: "melon-honeydew", name: "Honeydew Melon", categoryCode: "FRUITS", description: "Smooth pale rind with sweet green flesh that cubes cleanly for fruit salad.", storageKey: "fruitChill", inventoryBaseUnit: "PIECE", variants: pieceVariants("melon-honeydew", [{ priceMinor: 11000 }]) }),
  fp({ slug: "melon-muskmelon", name: "Muskmelon", categoryCode: "FRUITS", description: "Heavily perfumed muskmelon with salmon-orange flesh at full slip.", storageKey: "fruitChill", inventoryBaseUnit: "PIECE", variants: pieceVariants("melon-muskmelon", [{ priceMinor: 9000 }]) }),
  fp({ slug: "mulberry", name: "Mulberries", categoryCode: "FRUITS", description: "Juicy purple highland berries from Baguio-area gardens, fragile and fleeting in season.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("mulberry", { grams: 250, priceMinor: 9500, note: "About 50–70 tender mulberries per punnet-style cup." })], contentsLead: "Highland berry cups." }),
  fp({ slug: "orange", name: "Oranges", categoryCode: "FRUITS", description: "Round sweet oranges for juicing and hand segments.", storageKey: "fruitChill", inventoryBaseUnit: "GRAM", variants: weightVariants("orange", 18000) }),
  fp({ slug: "passion-fruit", name: "Passion Fruit", categoryCode: "FRUITS", description: "Wrinkled-purple shells hiding jelly-wrapped seeds with intense tropical tang.", storageKey: "fruitRoom", inventoryBaseUnit: "PIECE", variants: pieceVariants("passion-fruit", [{ priceMinor: 4500 }, { count: 4, priceMinor: 16500 }]) }),
  fp({ slug: "papaya", name: "Solo Papaya", categoryCode: "FRUITS", description: "Sweet orange-fleshed papaya selected for breakfast and dessert.", storageKey: "fruitRoom", inventoryBaseUnit: "PIECE", variants: pieceVariants("papaya", [{ priceMinor: 9500 }]), assetKey: "papaya-solo.webp" }),
  fp({ slug: "papaya-green", name: "Green Papaya", categoryCode: "FRUITS", description: "Unripe papaya shredded for atchara pickles and tinola soups.", storageKey: "root", inventoryBaseUnit: "PIECE", variants: pieceVariants("papaya-green", [{ priceMinor: 5500 }]) }),
  fp({ slug: "papaya-hawaiian", name: "Hawaiian Papaya", categoryCode: "FRUITS", description: "Compact pear-shaped papayas sized neatly for single servings.", storageKey: "fruitRoom", inventoryBaseUnit: "PIECE", variants: pieceVariants("papaya-hawaiian", [{ priceMinor: 7000 }]) }),
  fp({ slug: "papaya-native", name: "Native Papaya", categoryCode: "FRUITS", description: "Backyard-variety papaya with old-fashioned mellow sweetness.", storageKey: "fruitRoom", inventoryBaseUnit: "PIECE", variants: pieceVariants("papaya-native", [{ priceMinor: 6000 }]) }),
  fp({ slug: "papaya-export", name: "Papaya Solo (Graded)", categoryCode: "FRUITS", description: "Deliberately graded solo-type papaya picked for uniform color and shape.", storageKey: "fruitRoom", inventoryBaseUnit: "PIECE", variants: pieceVariants("papaya-export", [{ priceMinor: 11500 }]), assetKey: "papaya.webp" }),
  fp({ slug: "pears", name: "Pears", categoryCode: "FRUITS", description: "Imported Asian-style pears and rose pears offered while stock lasts.", storageKey: "fruitChill", inventoryBaseUnit: "GRAM", variants: weightVariants("pears", 34000) }),
  fp({ slug: "persimmon", name: "Persimmon", categoryCode: "FRUITS", description: "Orange lantern fruit custard-soft when fully ripe, sliced like tomato.", storageKey: "fruitChill", inventoryBaseUnit: "PIECE", variants: pieceVariants("persimmon", [{ priceMinor: 7500 }]) }),
  fp({ slug: "pineapple", name: "Sweet Pineapple", categoryCode: "FRUITS", description: "A bright tropical pineapple with a juicy, balanced finish.", storageKey: "fruitRoom", inventoryBaseUnit: "GRAM", variants: weightVariants("pineapple", 16500) }),
  fp({ slug: "pomelo", name: "Pomelo (Suha)", categoryCode: "FRUITS", description: "Thick-skinned citrus separated into juicy sacs for salads and suha-and-salt snacking.", storageKey: "fruitChill", inventoryBaseUnit: "PIECE", variants: pieceVariants("pomelo", [{ priceMinor: 13500 }]) }),
  fp({ slug: "rambutan", name: "Rambutan", categoryCode: "FRUITS", description: "Hairy crimson shell splitting to glossy white fruit clinging to a single pit.", storageKey: "fruitChill", inventoryBaseUnit: "GRAM", variants: weightVariants("rambutan", 24000) }),
  fp({ slug: "santol", name: "Santol", categoryCode: "FRUITS", description: "Cottony fruity layers sucked off seeds, or seeded into sinigang while sour.", storageKey: "fruitRoom", inventoryBaseUnit: "GRAM", variants: weightVariants("santol", 11000) }),
  fp({ slug: "sineguelas", name: "Sineguelas", categoryCode: "FRUITS", description: "Spanish plum cousins eaten skin-on with a green-bean snap into tart yellow flesh.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("sineguelas", 10000, [500]) }),
  fp({ slug: "star-apple", name: "Star Apple (Kaimito)", categoryCode: "FRUITS", description: "Purple-or-green round fruit whose star pattern appears when cut crosswise.", storageKey: "fruitRoom", inventoryBaseUnit: "PIECE", variants: pieceVariants("star-apple", [{ priceMinor: 5500 }]) }),
  fp({ slug: "strawberry", name: "Baguio Strawberries", categoryCode: "FRUITS", description: "Fresh strawberries for breakfast bowls, baking, and snacks.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("strawberry", 35800) }),
  fp({ slug: "tambis", name: "Tambis (Water Apple)", categoryCode: "FRUITS", description: "Waxy bell fruits soaked in water to stay crisp, refreshingly bland-tart.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("tambis", 9000, [500]) }),
  fp({ slug: "watermelon", name: "Seedless Watermelon", categoryCode: "FRUITS", description: "Crisp, hydrating watermelon for sharing and chilled desserts.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("watermelon", 19900) }),
  fp({ slug: "zapote", name: "Zapote", categoryCode: "FRUITS", description: "Round rust-toned fruit related to chico with grainy sweet chocolate-tinged pulp.", storageKey: "fruitRoom", inventoryBaseUnit: "PIECE", variants: pieceVariants("zapote", [{ priceMinor: 5000 }]) }),
];

/* ------------------------------------------------------------------ */
/* Vegetables                                                          */
/* ------------------------------------------------------------------ */

const VEGETABLES: ProduceSeedProduct[] = [
  fp({ slug: "ampalaya-fruit-bitter-gourd", name: "Ampalaya (Bitter Gourd)", categoryCode: "VEGETABLES", description: "Ridged bitter melon tamed with salt for pinakbet, ampalaya con carne, and ensalada.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("ampalaya-fruit-bitter-gourd", 8000) }),
  fp({ slug: "asparagus", name: "Asparagus", categoryCode: "VEGETABLES", description: "Tight-tipped green spears that snap cleanly for quick steaming or roasting.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("asparagus", 24000, [250, 500]) }),
  fp({ slug: "bamboo-shoots", name: "Bamboo Shoots (Labong)", categoryCode: "VEGETABLES", description: "Fresh-cut bamboo shoots needing a boiled draw-out before adding to ginataang labong.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("bamboo-shoots", 9000, [500]) }),
  fp({ slug: "banana-blossom", name: "Banana Blossom", categoryCode: "VEGETABLES", description: "Purple heart of the banana plant, stripped and soaked for sisig or adobo-style pulls.", storageKey: "chill", inventoryBaseUnit: "PIECE", variants: pieceVariants("banana-blossom", [{ priceMinor: 3000 }]) }),
  fp({ slug: "banana-pith", name: "Banana Pith (Puso ng Saging Core)", categoryCode: "VEGETABLES", description: "The tender white core inside the banana trunk, prepared like bamboo shoots in stews.", storageKey: "chill", inventoryBaseUnit: "PIECE", variants: pieceVariants("banana-pith", [{ priceMinor: 3500 }]) }),
  fp({ slug: "bell-pepper", name: "Bell Pepper", categoryCode: "VEGETABLES", description: "Blocky sweet peppers in green, red, or yellow for ginisa, steak sides, and salads.", storageKey: "chill", inventoryBaseUnit: "PIECE", variants: pieceVariants("bell-pepper", [{ priceMinor: 3500 }, { count: 3, priceMinor: 9900 }]) }),
  fp({ slug: "broccoli", name: "Fresh Broccoli", categoryCode: "VEGETABLES", description: "Tender green florets ideal for roasting, steaming, and stir-fries.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("broccoli", 21800) }),
  fp({ slug: "cabbage", name: "Baguio Cabbage", categoryCode: "VEGETABLES", description: "Tightly packed cabbage for soups, slaws, and stir-fries.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("cabbage", 11700) }),
  fp({ slug: "cauliflower", name: "Cauliflower", categoryCode: "VEGETABLES", description: "Snow-white curds held in crisp ivory jackets, excellent pulot-pared for mash or chop suey.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("cauliflower", 26000) }),
  fp({ slug: "chayote-fruit", name: "Chayote", categoryCode: "VEGETABLES", description: "Wrinkled pale-green pear vegetables that stay silky in chicken tinola and ginisang dishes.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("chayote-fruit", 8000) }),
  fp({ slug: "chinese-cabbage-wongbok-pechay-baguio", name: "Pechay Baguio (Wongbok)", categoryCode: "VEGETABLES", description: "Crisp napa-type cabbage with spoon-shaped ribs made for kimchi, hotpots, and soups.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("chinese-cabbage-wongbok-pechay-baguio", 13000) }),
  fp({ slug: "cucumber", name: "Cucumber", categoryCode: "VEGETABLES", description: "Everyday cucumbers with thin skins and cooling crunch for ensalad pipino.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("cucumber", 15300) }),
  fp({ slug: "eggplant", name: "Purple Eggplant", categoryCode: "VEGETABLES", description: "Glossy local eggplant for grilling, stews, and tortang talong.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("eggplant", 13700) }),
  fp({ slug: "hevi", name: "Hevi (Assorted Market Vegetables)", categoryCode: "VEGETABLES", description: "A practical market mix of assorted firm vegetables bundled for everyday ginisa bases.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("hevi", { grams: 500, priceMinor: 4500, note: "An assortment may vary with the market day." })], contentsLead: "Curated assorted vegetables." }),
  fp({ slug: "japanese-cucumber", name: "Japanese Cucumber", categoryCode: "VEGETABLES", description: "Crisp, thin-skinned burpless cucumbers for salads, sunomono, and pickles.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("japanese-cucumber", 16000) }),
  fp({ slug: "jackfruit-young", name: "Young Jackfruit", categoryCode: "VEGETABLES", description: "Immature langka sections with shreddable flesh for ginataang langka and adobo pulls.", storageKey: "chill", inventoryBaseUnit: "PIECE", variants: pieceVariants("jackfruit-young", [{ priceMinor: 6000 }]) }),
  fp({ slug: "kamansi", name: "Kamansi (Seeded Breadfruit)", categoryCode: "VEGETABLES", description: "Spiky seeded breadfruit cooked like unripe jackfruit in coconut milk stews.", storageKey: "root", inventoryBaseUnit: "PIECE", variants: pieceVariants("kamansi", [{ priceMinor: 5000 }]) }),
  fp({ slug: "kundol-wax-gourd", name: "Kundol (Wax Gourd)", categoryCode: "VEGETABLES", description: "Powder-coated winter melon cubed into soups and traditional kundol candy.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("kundol-wax-gourd", 6000) }),
  fp({ slug: "malunggay-fruit", name: "Malunggay Pods", categoryCode: "VEGETABLES", description: "Young drumstick pods slit and scraped into soups the Ilocano way.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("malunggay-fruit", { grams: 250, priceMinor: 2500, note: "Roughly 8–12 pods per pack." })], contentsLead: "Tender pod pieces." }),
  fp({ slug: "mushroom", name: "Mushrooms", categoryCode: "VEGETABLES", description: "Fresh button-style mushrooms cleaned quickly and sautéed while plump.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("mushroom", 28000, [250]) }),
  fp({ slug: "mustard-greens", name: "Mustard Greens", categoryCode: "VEGETABLES", description: "Peppery broadleaf greens that stand up to braises and clear soups.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("mustard-greens", { grams: 250, bunch: true, priceMinor: 3000, note: "A generous tied bundle of young mustard leaves." })], contentsLead: "Field-cut leafy bunches." }),
  fp({ slug: "okra-ladys-finger", name: "Okra", categoryCode: "VEGETABLES", description: "Small tender pods that slice neatly into sinigang and pinakbet without woodiness.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("okra-ladys-finger", 11000) }),
  fp({ slug: "patola-sponge-gourd", name: "Patola (Sponge Gourd)", categoryCode: "VEGETABLES", description: "Long striped gourd dissolving into misua soup with a silk texture.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("patola-sponge-gourd", 10000) }),
  fp({ slug: "pepper", name: "Sweet Peppers", categoryCode: "VEGETABLES", description: "Locally grown sweet peppers harvested green or partly colored.", storageKey: "chill", inventoryBaseUnit: "PIECE", variants: pieceVariants("pepper", [{ priceMinor: 3000 }]) }),
  fp({ slug: "radish", name: "Radish (Labanos)", categoryCode: "VEGETABLES", description: "Ivory-fleshed radishes grated for okoy fritters or dropped into sinigang.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("radish", 8000) }),
  fp({ slug: "squash-fruit", name: "Squash (Kalabasa)", categoryCode: "VEGETABLES", description: "Dense golden kalabasa that melts into ginataan, bulanglang, and noodle toppings.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("squash-fruit", 6000) }),
  fp({ slug: "tomato", name: "Roma Tomatoes", categoryCode: "VEGETABLES", description: "Firm tomatoes suited to sauces, salads, and everyday cooking.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("tomato", 12900) }),
  fp({ slug: "upo-bottle-gourd", name: "Upo (Bottle Gourd)", categoryCode: "VEGETABLES", description: "Pale bottle gourd with melt-soft flesh classic in ginisang upo with shrimp.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("upo-bottle-gourd", 8000) }),
  fp({ slug: "young-corn", name: "Young Corn", categoryCode: "VEGETABLES", description: "Baby cobs harvested early, blanched briefly for buttered sides and chopsuey.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("young-corn", 14000, [250, 500]) }),
  fp({ slug: "zucchini", name: "Zucchini", categoryCode: "VEGETABLES", description: "Straight dark-green courgettes for grills, grating, and quick sautés.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("zucchini", 13000) }),
];

/* ------------------------------------------------------------------ */
/* Leafy greens & herbs                                                */
/* ------------------------------------------------------------------ */

const LEAFY_GREENS_HERBS: ProduceSeedProduct[] = [
  fp({ slug: "agitway", name: "Agitway Greens", categoryCode: "LEAFY_GREENS_HERBS", description: "Rural hedgerow greens blanched like saluyot for simple home tables.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("agitway", { grams: 250, bunch: true, priceMinor: 2500, note: "A market-day bundle of fresh agitway tips." })], contentsLead: "Traditional leafy bunches." }),
  fp({ slug: "alugbati", name: "Alugbati (Malabar Spinach)", categoryCode: "LEAFY_GREENS_HERBS", description: "Vining spinach relative whose succulent purple-stemmed leaves thicken soups naturally.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("alugbati", { grams: 250, bunch: true, priceMinor: 3000, note: "One flexible cooking bundle of vine spinach." })], contentsLead: "Traditional leafy bunches." }),
  fp({ slug: "ampalaya-leaves", name: "Ampalaya Leaves", categoryCode: "LEAFY_GREENS_HERBS", description: "Tender bitter-gourd tops folded into molo soup and dalahon broths.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("ampalaya-leaves", { grams: 200, priceMinor: 3500, note: "Hand-picked tender top leaves only." })], contentsLead: "Hand-picked leafy tops." }),
  fp({ slug: "apat-apat", name: "Apat-Apat", categoryCode: "LEAFY_GREENS_HERBS", description: "Creeping waterside herb rinsed young for salads and light broths.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("apat-apat", { grams: 250, bunch: true, priceMinor: 2500, note: "A loose four-stem bundle tradition lends its name to." })], contentsLead: "Traditional leafy bunches." }),
  fp({ slug: "basil", name: "Sweet Basil", categoryCode: "LEAFY_GREENS_HERBS", description: "Fragrant Genoa-style basil leaves for pestos, pastas, and tomato plates.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("basil", { grams: 100, priceMinor: 5500, note: "Approximately 30–40 large basil leaves per pack." })], contentsLead: "Culinary herb packs." }),
  fp({ slug: "bago-leaves", name: "Bago Leaves", categoryCode: "LEAFY_GREENS_HERBS", description: "Backyard gnetum-style leaves boiled tender in provincial vegetable soups.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("bago-leaves", { grams: 250, bunch: true, priceMinor: 2500, note: "Young selection leaves tied market-style." })], contentsLead: "Traditional leafy bunches." }),
  fp({ slug: "camote-tops", name: "Camote Tops (Talbos)", categoryCode: "LEAFY_GREENS_HERBS", description: "Sweet potato vines snapped at the crown, blanched to jade for sinigang sides.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("camote-tops", { grams: 250, bunch: true, priceMinor: 2500, note: "Tender vine tips with leaves intact." })], contentsLead: "Traditional leafy bunches." }),
  fp({ slug: "cassava-tops", name: "Cassava Tops", categoryCode: "LEAFY_GREENS_HERBS", description: "Young cassava leaves simmered patiently until their character mellows.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("cassava-tops", { grams: 200, bunch: true, priceMinor: 2500, note: "Topmost tender leaves gathered in folds." })], contentsLead: "Traditional leafy bunches." }),
  fp({ slug: "celery", name: "Celery", categoryCode: "LEAFY_GREENS_HERBS", description: "Ribbed local celery for sofrito, stocks, and crisp salad finish.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("celery", { grams: 250, bunch: true, priceMinor: 4500, note: "A tight bundle of trimmed celery stalks and leaves." })], contentsLead: "Aromatic stalk bundles." }),
  fp({ slug: "chayote-tops", name: "Chayote Tops", categoryCode: "LEAFY_GREENS_HERBS", description: "Vine tips gathered before the tendrils toughen, treated like soft greens.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("chayote-tops", { grams: 200, bunch: true, priceMinor: 2500, note: "Shoot ends with two to three leaves each." })], contentsLead: "Traditional leafy bunches." }),
  fp({ slug: "chaysim", name: "Chay Shoots (Chaysim)", categoryCode: "LEAFY_GREENS_HERBS", description: "Mountain-grown chayote shoots prized by Cordillera kitchens for subtle sweetness.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("chaysim", { grams: 250, bunch: true, priceMinor: 2500, note: "Hand-pinched growing tips." })], contentsLead: "Traditional leafy bunches." }),
  fp({ slug: "chili-pepper-leaves", name: "Chili Pepper Leaves", categoryCode: "LEAFY_GREENS_HERBS", description: "Heart-shaped chili foliage brightening tinolang manok in the final minutes.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("chili-pepper-leaves", { grams: 100, priceMinor: 4000, note: "Picked leaves, stems removed; a small but potent handful." })], contentsLead: "Soup-ready leafy picks." }),
  fp({ slug: "chinese-malunggay", name: "Chinese Malunggay", categoryCode: "LEAFY_GREENS_HERBS", description: "Broad-leaflet moringa strain stripping easily for hot soups.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("chinese-malunggay", { grams: 250, bunch: true, priceMinor: 3000, note: "Leaflets stripped or kept on twigs as preferred." })], contentsLead: "Traditional leafy bunches." }),
  fp({ slug: "malunggay-leaves", name: "Malunggay Leaves", categoryCode: "LEAFY_GREENS_HERBS", description: "Fresh-stripped moringa leaflets stirred into soups and omelades at the last minute.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("malunggay-leaves", { grams: 200, priceMinor: 3000, note: "Washed leaflets only; stems removed." })], contentsLead: "Soup-ready leafy picks." }),
  fp({ slug: "chives", name: "Chives", categoryCode: "LEAFY_GREENS_HERBS", description: "Snipped hollow blades finishing dumplings, pansit, and omelets.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("chives", { grams: 100, priceMinor: 4000, note: "One kitchen bunch, blade length roughly forearm-short." })], contentsLead: "Kitchen herb packs." }),
  fp({ slug: "coriander-cilantro", name: "Coriander (Cilantro)", categoryCode: "LEAFY_GREENS_HERBS", description: "Roots-in cilantro bunches lifting pho bowls, kilawin, and salsa frescas.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("coriander-cilantro", { grams: 50, priceMinor: 5000, note: "Small perfumed bunch; about two fists wide." })], contentsLead: "Kitchen herb packs." }),
  fp({ slug: "cowpea-tops", name: "Cowpea Tops", categoryCode: "LEAFY_GREENS_HERBS", description: "Bean-field leafage pulled young for bitter-edge broths.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("cowpea-tops", { grams: 250, bunch: true, priceMinor: 2500, note: "A farm-basket bundle of young bean leaves." })], contentsLead: "Traditional leafy bunches." }),
  fp({ slug: "gabi-leaves-with-stem", name: "Gabi Leaves with Stem", categoryCode: "LEAFY_GREENS_HERBS", description: "Cleared taro leaves with trimmed stems readied for laing or pinangat wraps.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("gabi-leaves-with-stem", { grams: 500, bunch: true, priceMinor: 4500, note: "Large blanched-ready leaves plus firm stems." })], contentsLead: "Laing-grade leaf bundles." }),
  fp({ slug: "garlic-leeks", name: "Leeks", categoryCode: "LEAFY_GREENS_HERBS", description: "Slender allium stalks with mild garlic character for braises and pancit aromatics.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("garlic-leeks", { grams: 250, bunch: true, priceMinor: 4000, note: "Three to five young leek stalks per bundle." })], contentsLead: "Allium stalk bundles." }),
  fp({ slug: "kangkong", name: "Fresh Kangkong", categoryCode: "LEAFY_GREENS_HERBS", description: "Tender water spinach bundled for soups and quick sautes.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: weightVariants("kangkong", 9900), assetKey: "kangkong-swamp-cabbage.webp" }),
  fp({ slug: "kinchay", name: "Kinchay (Chinese Celery)", categoryCode: "LEAFY_GREENS_HERBS", description: "Thin intense celery leaf-ribs essential to pancit showers and siomai dips.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("kinchay", { grams: 100, priceMinor: 4500, note: "One strong-flavored market bunch." })], contentsLead: "Kitchen herb packs." }),
  fp({ slug: "kulitis", name: "Kulitis (Wild Amaranth)", categoryCode: "LEAFY_GREENS_HERBS", description: "Spiny amaranth gathered young; a backyard green that cooks down quick and soft.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("kulitis", { grams: 250, bunch: true, priceMinor: 2500, note: "Top cuttings only, spines stripped at gather." })], contentsLead: "Traditional leafy bunches." }),
  fp({ slug: "lettuce", name: "Lettuce", categoryCode: "LEAFY_GREENS_HERBS", description: "Cool-stored loose leaves and mini heads for burgers, wraps, and garden bowls.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("lettuce", { grams: 300, bunch: true, priceMinor: 6500, note: "Leaves layered loosely; shatter-crisp when iced briefly." })], contentsLead: "Salad-grade leaf packs." }),
  fp({ slug: "mint", name: "Fresh Mint", categoryCode: "LEAFY_GREENS_HERBS", description: "Cool peppermint sprigs for mojito glasses, iced teas, and lamb plates.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("mint", { grams: 50, priceMinor: 4500, note: "Six to ten tip-heavy sprigs per pack." })], contentsLead: "Culinary herb packs." }),
  fp({ slug: "onion-leeks", name: "Onion Leeks", categoryCode: "LEAFY_GREENS_HERBS", description: "Strapping allium blades sliced on the bias for leek-and-potato comfort pots.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("onion-leeks", { grams: 250, bunch: true, priceMinor: 5000, note: "Washed at home; grit hides between the layers." })], contentsLead: "Allium stalk bundles." }),
  fp({ slug: "parsley", name: "Flat-Leaf Parsley", categoryCode: "LEAFY_GREENS_HERBS", description: "Clean grassy parsley for chimichurri, garnish showers, and garlic bread.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("parsley", { grams: 50, priceMinor: 5000, note: "Tightly curled-free flat leaves only." })], contentsLead: "Culinary herb packs." }),
  fp({ slug: "pechay", name: "Native Pechay", categoryCode: "LEAFY_GREENS_HERBS", description: "Fresh leafy pechay for soups, noodles, and quick stir-fries.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: weightVariants("pechay", 10900), assetKey: "pechay-native.webp" }),
  fp({ slug: "pechay-hybrid", name: "Pechay (Hybrid)", categoryCode: "LEAFY_GREENS_HERBS", description: "Dense-headed modern pechay bred for heavier ribs and extended shelf life.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: weightVariants("pechay-hybrid", 12000), assetKey: "pechay.webp" }),
  fp({ slug: "saluyot", name: "Saluyot (Jute Leaves)", categoryCode: "LEAFY_GREENS_HERBS", description: "Silken-texture jute leaves giving Ilocano broths their characteristic glide.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("saluyot", { grams: 250, bunch: true, priceMinor: 2500, note: "A market tie of leaf-and-tip shoots." })], contentsLead: "Traditional leafy bunches." }),
  fp({ slug: "spinach", name: "Spinach", categoryCode: "LEAFY_GREENS_HERBS", description: "Tender cultivated spinach wilting instantly into cream and garlic pans.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("spinach", { grams: 300, bunch: true, priceMinor: 6500, note: "Triple-washed at home recommended; sandy root ends." })], contentsLead: "Salad-grade leaf packs." }),
  fp({ slug: "spring-onion", name: "Spring Onions", categoryCode: "LEAFY_GREENS_HERBS", description: "Two-tone scallions raining green confetti over lugaw, sisig, and fried rice.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("spring-onion", { grams: 250, bunch: true, priceMinor: 3000, note: "Ten to fifteen pencil-thin scallions." })], contentsLead: "Allium stalk bundles." }),
  fp({ slug: "squash-tops", name: "Squash Tops (Dahon ng Kalabasa)", categoryCode: "LEAFY_GREENS_HERBS", description: "Fuzzy vine leaves threaded through inun-unan and simple coastal vegetable stews.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("squash-tops", { grams: 200, bunch: true, priceMinor: 2500, note: "Newest growth with curling tendril tips." })], contentsLead: "Traditional leafy bunches." }),
  fp({ slug: "talinum", name: "Talinum (Philippine Spinach)", categoryCode: "LEAFY_GREENS_HERBS", description: "Sun-loving succulent-leaf green holding body even in long simmers.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("talinum", { grams: 250, bunch: true, priceMinor: 2500, note: "Water-flushed bundles that re-crisp in cold soak." })], contentsLead: "Traditional leafy bunches." }),
  fp({ slug: "watercress", name: "Watercress", categoryCode: "LEAFY_GREENS_HERBS", description: "Peppery stream-bed greens elevating sandwiches and cleared consommés.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("watercress", { grams: 250, bunch: true, priceMinor: 5500, note: "Flowing-water grown sprigs, brief-chilled." })], contentsLead: "Premium leafy packs." }),
];

/* ------------------------------------------------------------------ */
/* Roots, tubers & bulbs                                               */
/* ------------------------------------------------------------------ */

const ROOTS_TUBERS_BULBS: ProduceSeedProduct[] = [
  fp({ slug: "arrowroot", name: "Arrowroot (Uraro)", categoryCode: "ROOTS_TUBERS_BULBS", description: "Fine-starch tubers traditionally pressed for uraro cookies and gentle thickeners.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("arrowroot", 9000, [500]) }),
  fp({ slug: "beets", name: "Beets", categoryCode: "ROOTS_TUBERS_BULBS", description: "Ruby beetroots roasting into caramel sweetness or grating raw into slaws.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("beets", 14000) }),
  fp({ slug: "camote-sweet-potato", name: "Camote (Sweet Potato)", categoryCode: "ROOTS_TUBERS_BULBS", description: "Cream-fleshed sweet potatoes frying into camote cues or boiling merienda-soft.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("camote-sweet-potato", 9000) }),
  fp({ slug: "cassava-for-food-fresh-tubers", name: "Cassava (Food Grade)", categoryCode: "ROOTS_TUBERS_BULBS", description: "Table-grade cassava tubers peeled and boiled for nilupak or cassava cake.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("cassava-for-food-fresh-tubers", 7500) }),
  fp({ slug: "cassava-for-industrial-use-fresh-tubers", name: "Cassava (Processing Grade)", categoryCode: "ROOTS_TUBERS_BULBS", description: "Bulk-processing cassava lots supplied for starch pressing and commercial preparation.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("cassava-for-industrial-use-fresh-tubers", 5500) }),
  fp({ slug: "cassava-fresh-tubers", name: "Fresh Cassava", categoryCode: "ROOTS_TUBERS_BULBS", description: "Standard-market cassava readily boiled, grated, or dried into flakes.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("cassava-fresh-tubers", 7000) }),
  fp({ slug: "carrot", name: "Highland Carrots", categoryCode: "ROOTS_TUBERS_BULBS", description: "Crunchy carrots with a naturally sweet finish.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("carrot", 13900) }),
  fp({ slug: "gabi-runner", name: "Gabi Runners", categoryCode: "ROOTS_TUBERS_BULBS", description: "Slender taro runners peeling like baby tubers for laing stretching and soups.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("gabi-runner", 7000, [500]) }),
  fp({ slug: "gabi-taro", name: "Gabi (Taro)", categoryCode: "ROOTS_TUBERS_BULBS", description: "Starchy taro corms dissolving into sinigang broth with signature thickness.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("gabi-taro", 11000) }),
  fp({ slug: "garlic", name: "Native Garlic", categoryCode: "ROOTS_TUBERS_BULBS", description: "Fragrant native garlic with bold flavor for Filipino cooking.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("garlic", 25800), assetKey: "garlic-dried-bulb.webp" }),
  fp({ slug: "ginger", name: "Ginger (Luya)", categoryCode: "ROOTS_TUBERS_BULBS", description: "Knotted heat rhizomes smashed for tinola steam and salabat cups.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("ginger", 17000) }),
  fp({ slug: "onion-bermuda", name: "Bermuda Onions", categoryCode: "ROOTS_TUBERS_BULBS", description: "Flat-topped sweet-leaning onions slicing wide for rings and Sofrito beds.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("onion-bermuda", 26000) }),
  fp({ slug: "onion-mature-bulb", name: "Onions (Mature Bulb)", categoryCode: "ROOTS_TUBERS_BULBS", description: "Fully cured storage onions carrying long shelf life and assertive bite.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("onion-mature-bulb", 24000) }),
  fp({ slug: "red-onion", name: "Red Onion", categoryCode: "ROOTS_TUBERS_BULBS", description: "Fresh red onions.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("red-onion", 25800, [500, 1000]), assetKey: "onion-red-creole-bermuda-red.webp" }),
  fp({ slug: "onion-red-shallot-sibuyas-tagalog", name: "Sibuyas Tagalog (Shallot)", categoryCode: "ROOTS_TUBERS_BULBS", description: "Cloved small shallots with fierce perfume the base of honest sinigang saute.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("onion-red-shallot-sibuyas-tagalog", 32000, [250, 500]) }),
  fp({ slug: "onion-yellow-granex-bermuda-white", name: "Yellow Onion (Granex)", categoryCode: "ROOTS_TUBERS_BULBS", description: "Golden-skin onions balancing sweetness and sulfur for gravies and crock-pot draws.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("onion-yellow-granex-bermuda-white", 24000) }),
  fp({ slug: "potato", name: "Potatoes", categoryCode: "ROOTS_TUBERS_BULBS", description: "Versatile brown-skinned potatoes holding shape through stews and fries alike.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("potato", 11000) }),
  fp({ slug: "singkamas-turnip", name: "Singkamas (Mexican Turnip)", categoryCode: "ROOTS_TUBERS_BULBS", description: "Ice-crisp jicama bulbs peeled cold for lumpia crunch and afternoon salt dips.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("singkamas-turnip", 9000) }),
  fp({ slug: "ubi-greater-yam", name: "Ubi (Greater Yam)", categoryCode: "ROOTS_TUBERS_BULBS", description: "Purple-streaked yams steaming into halaya and halu-hano traditions.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("ubi-greater-yam", 16000) }),
  fp({ slug: "yacon", name: "Yacon", categoryCode: "ROOTS_TUBERS_BULBS", description: "Crunchy Andean tubers sweeter after days of sun-drying on the sill.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("yacon", 15000, [500]) }),
  fp({ slug: "yam-beans", name: "Yam Beans", categoryCode: "ROOTS_TUBERS_BULBS", description: "Clustered singkamas relatives sharing the same icy watery sweetness.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("yam-beans", 9500) }),
];

/* ------------------------------------------------------------------ */
/* Beans, peas & seeds                                                 */
/* ------------------------------------------------------------------ */

const BEANS_PEAS_SEEDS: ProduceSeedProduct[] = [
  fp({ slug: "black-beans", name: "Black Beans (Dry)", categoryCode: "BEANS_PEAS_SEEDS", description: "Midnight-skinned dry beans rewarding overnight soaking with earthy broths.", storageKey: "beans", inventoryBaseUnit: "GRAM", variants: weightVariants("black-beans", 13000, [250, 500, 1000]) }),
  fp({ slug: "cowpea", name: "Cowpeas (Fresh)", categoryCode: "BEANS_PEAS_SEEDS", description: "Freshly podded cream peas simmering Southern-side with smoke and soffritto.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("cowpea", 13000, [250, 500]) }),
  fp({ slug: "cowpea-dry", name: "Cowpeas (Dry)", categoryCode: "BEANS_PEAS_SEEDS", description: "Shelled and dried cowpeas keeping months in jars for slow Sunday pots.", storageKey: "beans", inventoryBaseUnit: "GRAM", variants: weightVariants("cowpea-dry", 16000, [250, 500, 1000]) }),
  fp({ slug: "cowpea-green", name: "Green Cowpeas", categoryCode: "BEANS_PEAS_SEEDS", description: "Immature green-hull peas blanch-free straight into coconut stews.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("cowpea-green", 14000, [250, 500]) }),
  fp({ slug: "garbanzos-chickpeas", name: "Chickpeas (Garbanzos)", categoryCode: "BEANS_PEAS_SEEDS", description: "Round beige garbanzos swelling hummus-smooth or dropping whole into callos.", storageKey: "beans", inventoryBaseUnit: "GRAM", variants: weightVariants("garbanzos-chickpeas", 17000, [250, 500, 1000]) }),
  fp({ slug: "gisantes-garden-peas", name: "Garden Peas (Gisantes)", categoryCode: "BEANS_PEAS_SEEDS", description: "Emerald shelling peas folded into chicken pastel and arroz dishes.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("gisantes-garden-peas", 18000, [250, 500]) }),
  fp({ slug: "habitchuelas-snap-beans", name: "Snap Beans (Habitchuelas)", categoryCode: "BEANS_PEAS_SEEDS", description: "String-flat green beans snapping at both ends for ginisang sitaw partners.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("habitchuelas-snap-beans", 12000, [250, 500]) }),
  fp({ slug: "kadios-pigeon-peas", name: "Kadios (Pigeon Peas)", categoryCode: "BEANS_PEAS_SEEDS", description: "Round slate peas defining Ilonggo KBL alongside baboy and langka.", storageKey: "beans", inventoryBaseUnit: "GRAM", variants: weightVariants("kadios-pigeon-peas", 14000, [250, 500, 1000]) }),
  fp({ slug: "kentucky-beans", name: "Kentucky Wonder Beans", categoryCode: "BEANS_PEAS_SEEDS", description: "Classic pole beans harvested full-bodied yet still bending without snap-crack.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("kentucky-beans", 14000, [250, 500]) }),
  fp({ slug: "kidney-beans", name: "Kidney Beans (Mixed)", categoryCode: "BEANS_PEAS_SEEDS", description: "Dark-and-light kidney medleys lending body to chili pots and salads.", storageKey: "beans", inventoryBaseUnit: "GRAM", variants: weightVariants("kidney-beans", 14500, [250, 500, 1000]) }),
  fp({ slug: "kidney-beans-red", name: "Red Kidney Beans", categoryCode: "BEANS_PEAS_SEEDS", description: "Maroon arch-backed beans that hold their walls through long braise hours.", storageKey: "beans", inventoryBaseUnit: "GRAM", variants: weightVariants("kidney-beans-red", 15000, [250, 500, 1000]) }),
  fp({ slug: "kidney-beans-white", name: "White Kidney Beans", categoryCode: "BEANS_PEAS_SEEDS", description: "Ivory cannellini-style beans mashing creamily into spreads and minestrones.", storageKey: "beans", inventoryBaseUnit: "GRAM", variants: weightVariants("kidney-beans-white", 15000, [250, 500, 1000]) }),
  fp({ slug: "mongo-mung-bean", name: "Mung Beans (Mongo)", categoryCode: "BEANS_PEAS_SEEDS", description: "Tiny olive gems blooming into ginisang mongo stews with flaked fish.", storageKey: "beans", inventoryBaseUnit: "GRAM", variants: weightVariants("mongo-mung-bean", 13000, [250, 500, 1000]) }),
  fp({ slug: "patani-lima-beans", name: "Limabeans (Patani)", categoryCode: "BEANS_PEAS_SEEDS", description: "Flat broad limas slipping buttery from their skins in Ilonggo soups.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("patani-lima-beans", 13000, [250, 500]) }),
  fp({ slug: "peanut-with-shell-dry", name: "Peanuts In Shell (Dry)", categoryCode: "BEANS_PEAS_SEEDS", description: "Whole groundnuts roasting shell-on until the kernels chatter loose.", storageKey: "beans", inventoryBaseUnit: "GRAM", variants: weightVariants("peanut-with-shell-dry", 14000, [250, 500, 1000]) }),
  fp({ slug: "red-beans", name: "Red Beans", categoryCode: "BEANS_PEAS_SEEDS", description: "Small rose-tone beans thickening rice companions with smoky accompaniment.", storageKey: "beans", inventoryBaseUnit: "GRAM", variants: weightVariants("red-beans", 14500, [250, 500, 1000]) }),
  fp({ slug: "sigarilyas-winged-beans", name: "Winged Beans (Sigarilyas)", categoryCode: "BEANS_PEAS_SEEDS", description: "Four-ridged frilled pods shaved thin for adobo-soft simmers and quick blanches.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("sigarilyas-winged-beans", 12000, [250, 500]) }),
  fp({ slug: "sitao-string-beans", name: "String Beans (Sitao)", categoryCode: "BEANS_PEAS_SEEDS", description: "Long-flexible yardlong beans cut knuckle lengths for kare-kare and ginisa.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("sitao-string-beans", 11000, [250, 500]) }),
  fp({ slug: "soybeans", name: "Soybeans (Dry)", categoryCode: "BEANS_PEAS_SEEDS", description: "Oil-rich dry soybeans for home soymilk, tahô blocks, and roasting snack batches.", storageKey: "beans", inventoryBaseUnit: "GRAM", variants: weightVariants("soybeans", 14000, [250, 500, 1000]) }),
  fp({ slug: "sweet-peas", name: "Sweet Peas", categoryCode: "BEANS_PEAS_SEEDS", description: "Plump-seeded snow-shell peas snacking raw as readily as they steam.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: weightVariants("sweet-peas", 16000, [250, 500]) }),
  fp({ slug: "wonder-beans", name: "Wonder Beans", categoryCode: "BEANS_PEAS_SEEDS", description: "Heritage winged-cross beans bubbling soft with ancestral pork stew beds.", storageKey: "beans", inventoryBaseUnit: "GRAM", variants: weightVariants("wonder-beans", 13500, [250, 500, 1000]) }),
];

/* ------------------------------------------------------------------ */
/* Aromatics & spices                                                  */
/* ------------------------------------------------------------------ */

const AROMATICS_SPICES: ProduceSeedProduct[] = [
  fp({ slug: "achuete", name: "Achuete (Annatto Seeds)", categoryCode: "AROMATICS_SPICES", description: "Rust-coated annatto seeds steeped in oil for ARoz caldo color and pancit glow.", storageKey: "beans", inventoryBaseUnit: "GRAM", variants: [packVariant("achuete", { grams: 100, priceMinor: 4500, note: "Seeds strained out after steeping; a little goes far." })], contentsLead: "Coloring seed packs." }),
  fp({ slug: "chili-pepper-fruit-siling-labuyo", name: "Siling Labuyo", categoryCode: "AROMATICS_SPICES", description: "Fresh local chili peppers.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("chili-pepper-fruit-siling-labuyo", { grams: 100, priceMinor: 6500, note: "Approximately 10–15 chili peppers per pack." , ops: "Pack 100 g per bag."})], contentsLead: "Fiery heat in fixed packs." }),
  fp({ slug: "finger-pepper", name: "Finger Pepper (Siling Haba)", categoryCode: "AROMATICS_SPICES", description: "Slender green chilies tempering sinigang bowls and crispy toyomansi dips.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("finger-pepper", { grams: 100, priceMinor: 4000, note: "About 8–12 medium finger chilies per pack." })], contentsLead: "Heat manageable packs." }),
  fp({ slug: "kamias-aromatic", name: "Kamias (Bilimbi)", categoryCode: "AROMATICS_SPICES", description: "Blistered green sour fingers standing in for tamarind at short notice.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("kamias-aromatic", { grams: 250, priceMinor: 4000, note: "Sixteen to twenty-five finger fruits per pack." })], contentsLead: "Souring-agent packs." , assetKey: "kamias.webp"}),
  fp({ slug: "laurel", name: "Bay Leaves (Laurel)", categoryCode: "AROMATICS_SPICES", description: "Aromatic bay for adobo baths, bean pots, and pickling vats.", storageKey: "beans", inventoryBaseUnit: "GRAM", variants: [packVariant("laurel", { grams: 50, priceMinor: 4000, note: "Twenty-five to thirty-five dried leaf blades per pouch." })], contentsLead: "Simmer-leaf pouches." }),
  fp({ slug: "paminta-black-pepper", name: "Black Pepper (Paminta)", categoryCode: "AROMATICS_SPICES", description: "Fresh-harvest green-black peppercorn clusters for drying down or brine-pickling.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("paminta-black-pepper", { grams: 250, priceMinor: 9000, note: "Berry clusters with vine snippets removed." })], contentsLead: "Harvest-condition spice packs." }),
  fp({ slug: "pandan-fresh-leaves", name: "Pandan Leaves (Fresh)", categoryCode: "AROMATICS_SPICES", description: "Fragrant screw-pine blades knotting into rice cookers and coco jams.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("pandan-fresh-leaves", { grams: 100, priceMinor: 3000, note: "Five to eight knife-length blades per pack." })], contentsLead: "Perfume-leaf bundles." }),
  fp({ slug: "tamarind-fruit", name: "Tamarind (Sampalok)", categoryCode: "AROMATICS_SPICES", description: "Brittle-shell pods whose sour pulp seasons sinigang to mouth-water balance.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("tamarind-fruit", 14000, [250, 500]) }),
  fp({ slug: "tanglad-lemongrass", name: "Lemongrass (Tanglad)", categoryCode: "AROMATICS_SPICES", description: "Citrus-oil filled stalks bruised for lechon cavities and lemongrass tea.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("tanglad-lemongrass", { grams: 100, bunch: true, priceMinor: 3000, note: "Four to six oil-rich stalks per bundle." })], contentsLead: "Citrus-stalk bundles." }),
  fp({ slug: "luyang-dilaw-turmeric", name: "Turmeric (Luyang Dilaw)", categoryCode: "AROMATICS_SPICES", description: "Saffron-gold rhizomes staining curries golden and health-teas warm.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: weightVariants("luyang-dilaw-turmeric", 14000) }),
];

/* ------------------------------------------------------------------ */
/* Native & specialty produce                                          */
/* ------------------------------------------------------------------ */

const NATIVE_SPECIALTY_PRODUCE: ProduceSeedProduct[] = [
  fp({ slug: "alubihod", name: "Alubihod Seaweed", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Sun-warmed edible seaweed tossed cold with tomato and onion in coastal salads.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("alubihod", { grams: 250, priceMinor: 4000, note: "Rinsed salt-water fronds; serve very cold." })], contentsLead: "Coastal harvest packs." }),
  fp({ slug: "alucon", name: "Alucon Greens", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Highland-gathered paddle leaves boiled twice for mountain-plain soups.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("alucon", { grams: 250, bunch: true, priceMinor: 2500, note: "Cut leaf paddings, coarse midribs excluded." })], contentsLead: "Foraged bundles." }),
  fp({ slug: "ariwat", name: "Ariwat Leaves", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Cloud-forest stems releasing natural MSG-style depth into Ilocano broths.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("ariwat", { grams: 250, bunch: true, priceMinor: 2500, note: "Forest-picked stems minus roots." })], contentsLead: "Foraged bundles." }),
  fp({ slug: "bagbagkong-flower", name: "Bagbagkong Flowers", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Ivory blossom clusters sautéed quickly with garlic before their perfume lifts.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("bagbagkong-flower", { grams: 200, priceMinor: 5000, note: "Open blossoms and buds mixed; brief-cooking only." })], contentsLead: "Seasonal flower picks." }),
  fp({ slug: "bagbagkong-fruit", name: "Bagbagkong Fruit", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Ribbed green capsules splitting at maturity to reveal silky seed rows inside.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("bagbagkong-fruit", { grams: 250, priceMinor: 3500, note: "Ten to eighteen young capsules per pack." })], contentsLead: "Seasonal wild pods." }),
  fp({ slug: "ballaiba", name: "Ballaiba Herb", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Aromatic highland leaf pairings for gamey meats and burner teas.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("ballaiba", { grams: 100, priceMinor: 2500, note: "Tufted tips kept loosely bagged to breathe." })], contentsLead: "Foraged herb picks." }),
  fp({ slug: "batwan", name: "Batwan", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Ilonggo souring spheres fermenting quietly in jars for kansi depth all year.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("batwan", { grams: 250, priceMinor: 5000, note: "Forty to sixty marble-round sour fruits per pack." })], contentsLead: "Souring-agent packs." }),
  fp({ slug: "bawing-sulasi", name: "Sulasi (Holy Basil)", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Clove-scented sacred basil bursting colds teas and seafood tinola anew.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("bawing-sulasi", { grams: 50, priceMinor: 3000, note: "Fragrant tuft of tulsi-lineage leaves." })], contentsLead: "Foraged herb picks." }),
  fp({ slug: "camangeg", name: "Camangeg Greens", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Cool-slope swamp greens treating Cordillera tables between market runs.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("camangeg", { grams: 250, bunch: true, priceMinor: 2500, note: "Trail-bundled armful cut morning-fresh." })], contentsLead: "Foraged bundles." }),
  fp({ slug: "karamay", name: "Karamay Greens", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Village-edge pot herb softening nicely under quick salted boils.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("karamay", { grams: 250, bunch: true, priceMinor: 3000, note: "Tip-cut springs avoiding older fiber." })], contentsLead: "Foraged bundles." }),
  fp({ slug: "katuray", name: "Katuray Flowers", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "White hummingbird-tree blooms blanched briefly for ensalad katuray with tomatoes.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("katuray", { grams: 200, priceMinor: 4500, note: "Petal-perfect blooms with bitter heels pinched off." })], contentsLead: "Seasonal flower picks." }),
  fp({ slug: "kulibangbang", name: "Kulibangbang Wild Greens", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Butterfly-attracting field flora whose young shoots double as rustic pot greens.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("kulibangbang", { grams: 200, bunch: true, priceMinor: 2500, note: "Only shoot ends make the bundle." })], contentsLead: "Foraged bundles." }),
  fp({ slug: "labog-roselle", name: "Roselle (Labog)", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Ruby calyxes brewing crimson lemonsweet tisanes and glaze reductions.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("labog-roselle", { grams: 250, priceMinor: 5000, note: "Thirty to forty fleshy calyx cups per pack." })], contentsLead: "Specialty botanical packs." }),
  fp({ slug: "likway", name: "Likway Fern Tips", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Curling fern heads shook free of fuzz for pako-style salads with vinegar eggs.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("likway", { grams: 200, priceMinor: 3500, note: "Fiddleheads need full boiling before dressing." })], contentsLead: "Foraged fern picks." }),
  fp({ slug: "lipote", name: "Lipote Berries", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Glossy deep-purple plum-relative clusters rimming ancestral yards, tart to the core.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("lipote", { grams: 250, priceMinor: 4500, note: "Bunch-snipped darkest berries first." })], contentsLead: "Seasonal berry cups." }),
  fp({ slug: "lumbia-pith", name: "Lumbia Palm Pith", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Rare sugar-palm cores sago-mined into festival puddings down south.", storageKey: "root", inventoryBaseUnit: "PIECE", variants: pieceVariants("lumbia-pith", [{ priceMinor: 9000 }]) }),
  fp({ slug: "coconut-pith", name: "Coconut Pith (Ubod)", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Heart-of-palm straws crackling fresh in lumpiang ubod and coconut stews.", storageKey: "chill", inventoryBaseUnit: "PIECE", variants: pieceVariants("coconut-pith", [{ priceMinor: 12000 }]), assetKey: "coconut-pith.webp" }),
  fp({ slug: "lupo", name: "Lupo Reeds", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Waterway rushes whose inner cores pass through lowland soups as wild greens.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("lupo", { grams: 250, bunch: true, priceMinor: 2500, note: "Inner core strips only after peeling." })], contentsLead: "Foraged bundles." }),
  fp({ slug: "miracle-fruit", name: "Miracle Fruit", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Tiny berry flipping sour palates sweet for an hour-long tasting-party trick.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("miracle-fruit", { grams: 100, priceMinor: 8000, note: "Twelve to twenty red berries per sampler pack." })], contentsLead: "Novelty berry samplers." }),
  fp({ slug: "pako-edible-fern", name: "Pako (Edible Fern)", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Classic fern salad coils dressed in vinegar, tomato, and salted egg.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("pako-edible-fern", { grams: 200, priceMinor: 5000, note: "Bright green curls, woody stems snapped away." })], contentsLead: "Foraged fern picks." }),
  fp({ slug: "pangi", name: "Pangi Seeds (Processed)", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Traditionally cured keluak-style nuts lending earthy depths to southern stews.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: [packVariant("pangi", { grams: 500, priceMinor: 5000, note: "Wood-fire processed for safe household cooking." })], contentsLead: "Heritage ingredient packs." }),
  fp({ slug: "pao-galiang", name: "Pao Galiang Stems", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Marsh alocasia stems that surrender richness only through patient simmering.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("pao-galiang", { grams: 250, bunch: true, priceMinor: 2500, note: "Skin-off stems chopped ready for the pot." })], contentsLead: "Foraged bundles." }),
  fp({ slug: "papait", name: "Papait Leaves", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Signature bitterness for papaitan rebuilt responsibly from leaf rather than bile.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("papait", { grams: 100, priceMinor: 2500, note: "Pinched sprigs portioned for one strong pot." })], contentsLead: "Bold-flavor herb picks." }),
  fp({ slug: "radish-pods", name: "Radish Pods (Signad)", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Rat-tail radish pods popping like green beans with peppery sparks.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("radish-pods", { grams: 250, priceMinor: 3500, note: "Slim young pods picked pre-summer heat." })], contentsLead: "Pod-specialty packs." }),
  fp({ slug: "rattan-fruits", name: "Rattan Fruits", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Scaled berries whose acid flesh seasons Visayan fish stews.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: [packVariant("rattan-fruits", { grams: 500, priceMinor: 4000, note: "Nine to fourteen scaled globes per bag." })], contentsLead: "Regional specialty bags." }),
  fp({ slug: "rattan-pith", name: "Rattan Pith", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Jungle-harvest cane cores prepared northern-island style into merit-worthy sides.", storageKey: "root", inventoryBaseUnit: "GRAM", variants: [packVariant("rattan-pith", { grams: 500, priceMinor: 4500, note: "Boiled draw-outs required, as with labong." })], contentsLead: "Regional specialty bags." }),
  fp({ slug: "sabidokong", name: "Sabidokong Vines", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Climbing forest tendrils folded rare into upland fog-season cooking.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("sabidokong", { grams: 250, bunch: true, priceMinor: 2500, note: "Tender internodal cuts only." })], contentsLead: "Foraged bundles." }),
  fp({ slug: "sampinit-wild-raspberry", name: "Sampinit (Wild Raspberry)", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Volcano-slope raspberries crafted into preserves as fast as they soften.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("sampinit-wild-raspberry", { grams: 200, priceMinor: 8000, note: "About forty to sixty hillside-picked drupelets." })], contentsLead: "Highland berry cups." }),
  fp({ slug: "samsamping", name: "Samsamping", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Roselle-cousin leaves and pods enriching T'boli kitchen repertoires.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("samsamping", { grams: 200, priceMinor: 3000, note: "Leaf-and-pod mix per gather." })], contentsLead: "Indigenous green picks." }),
  fp({ slug: "sangig", name: "Sangig (Mountain Mint)", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Camiguin bush-mint kissing broths with cooling cedar-edged breath.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("sangig", { grams: 100, priceMinor: 3000, note: "Six to nine rooted-cutting sprigs." })], contentsLead: "Foraged herb picks." }),
  fp({ slug: "sayung-sayong", name: "Sayung-Sayong Pods", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Jar-handle shaped wild pods blanketing rural riverside menus each season.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("sayung-sayong", { grams: 250, priceMinor: 3000, note: "Immature pods only, seeds still soft." })], contentsLead: "Seasonal wild pods." }),
  fp({ slug: "serial-serales", name: "Serales Berries", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Star-apple cousins strung grapewise along shaded village fences.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("serial-serales", { grams: 250, priceMinor: 4000, note: "Tree-ripe purple picks by the fistful." })], contentsLead: "Seasonal berry cups." }),
  fp({ slug: "sugodsugod", name: "Sugodsugod Shoots", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Taro-flag inflorescences worth the double-boil draw traditionalists insist on.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("sugodsugod", { grams: 500, priceMinor: 3000, note: "Flower-head shoots with jackets stripped." })], contentsLead: "Foraged bundles." }),
  fp({ slug: "tabon-tabon", name: "Tabon-Tabon", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Brown de-bittering nuts granting Mindanaoan kilawin its clean edge.", storageKey: "root", inventoryBaseUnit: "PIECE", variants: pieceVariants("tabon-tabon", [{ count: 4, priceMinor: 3500 }]) }),
  fp({ slug: "tamarind-flower", name: "Tamarind Flowers", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Cream bud clusters fried golden as provincial appetizer crisps.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("tamarind-flower", { grams: 200, priceMinor: 3000, note: "Bud clusters gathered at first open." })], contentsLead: "Seasonal flower picks." }),
  fp({ slug: "tawri", name: "Tawri Wild Figs", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Forest fig kinds relished near-dusk when wasps finish their cycle.", storageKey: "chill", inventoryBaseUnit: "GRAM", variants: [packVariant("tawri", { grams: 250, priceMinor: 3000, note: "Firm-ripe figs hand-selected batch to batch." })], contentsLead: "Seasonal wild fruit cups." }),
  fp({ slug: "tugue", name: "Tugue Shoots", categoryCode: "NATIVE_SPECIALTY_PRODUCE", description: "Streamside shoots boiled bright-green for barangay feast trays.", storageKey: "leafy", inventoryBaseUnit: "GRAM", variants: [packVariant("tugue", { grams: 100, bunch: true, priceMinor: 2500, note: "Watercress-analog tips air-dried briefly post rinse." })], contentsLead: "Foraged bundles." }),
];

/**
 * Complete launch manifest. Category-section order here is editorial only;
 * validation normalizes deterministic ordering for generation.
 */
export const produceCatalog: ReadonlyArray<ProduceSeedProduct> = [
  ...FRUITS,
  ...VEGETABLES,
  ...LEAFY_GREENS_HERBS,
  ...ROOTS_TUBERS_BULBS,
  ...BEANS_PEAS_SEEDS,
  ...AROMATICS_SPICES,
  ...NATIVE_SPECIALTY_PRODUCE,
];
