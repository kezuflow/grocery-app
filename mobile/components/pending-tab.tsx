import { StyleSheet, Text, View } from "react-native";
import { palette } from "@/constants/palette";

export function PendingTab({ title, description }: { title: string; description: string }) {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background, padding: 24, paddingTop: 40 },
  title: { color: palette.ink, fontSize: 30, fontWeight: "800" },
  description: { color: palette.muted, fontSize: 15, lineHeight: 23, marginTop: 12 },
});
