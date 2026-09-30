import { Image, StyleSheet, Text, View } from "react-native";
import type { CatalogProduct } from "@freshmarkets/contracts";
import { palette } from "@/constants/palette";

const marketplaceOrigin = process.env.EXPO_PUBLIC_MARKETPLACE_ORIGIN;

export function ProductCard({ product }: { product: CatalogProduct }) {
  const imageUrl =
    product.media?.src && marketplaceOrigin
      ? new URL(product.media.src, marketplaceOrigin).toString()
      : null;
  return (
    <View style={styles.card}>
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
      <Text style={styles.note}>Choose a location for prices</Text>
    </View>
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
});
