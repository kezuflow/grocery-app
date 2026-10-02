import { useRouter } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { CatalogProduct } from "@freshmarkets/contracts";
import { palette } from "@/constants/palette";

const marketplaceOrigin = process.env.EXPO_PUBLIC_MARKETPLACE_ORIGIN ?? "https://freshmarkets.ph";

export function ProductCard({ product, width }: { product: CatalogProduct; width?: number }) {
  const router = useRouter();
  const imageUrl =
    product.media?.src && marketplaceOrigin
      ? new URL(product.media.src, marketplaceOrigin).toString()
      : null;
  const priced = product.variants.find(
    (variant) => variant.priceMinor !== null && variant.currency,
  );
  const price =
    priced && priced.currency
      ? new Intl.NumberFormat("en-PH", { style: "currency", currency: priced.currency }).format(
          (priced.sale?.priceMinor ?? priced.priceMinor!) / 100,
        )
      : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${product.name}`}
      onPress={() => router.push({ pathname: "/product/[slug]", params: { slug: product.slug } })}
      style={({ pressed }) => [styles.card, width ? { width } : null, pressed && styles.pressed]}
    >
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          style={styles.image}
          accessibilityLabel={product.media?.alt || product.name}
        />
      ) : (
        <View style={styles.image}>
          <Text style={styles.placeholder}>✳</Text>
        </View>
      )}
      <Text style={styles.category} numberOfLines={1}>
        {product.category.name}
      </Text>
      <Text style={styles.name} numberOfLines={2}>
        {product.name}
      </Text>
      <Text style={[styles.note, price && styles.price]}>
        {price ?? "Choose a location for prices"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 154,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 18,
    backgroundColor: "#fff",
    padding: 10,
  },
  pressed: { opacity: 0.72 },
  image: {
    width: "100%",
    height: 122,
    borderRadius: 12,
    backgroundColor: "#eef5e9",
    alignItems: "center",
    justifyContent: "center",
  },
  placeholder: { color: "#94b996", fontSize: 40 },
  category: {
    color: palette.green,
    fontSize: 10,
    fontWeight: "700",
    marginTop: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  name: { color: palette.ink, fontSize: 15, fontWeight: "700", minHeight: 40, marginTop: 5 },
  note: { color: palette.muted, fontSize: 11, marginTop: 8 },
  price: { color: palette.green, fontSize: 15, fontWeight: "800" },
});
