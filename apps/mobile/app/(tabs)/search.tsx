import { useState } from "react";
import { Keyboard, Pressable, Text, TextInput } from "react-native";
import { Screen, styles } from "../../components/screen";

export default function Search() {
  const [query, setQuery] = useState("");
  return (
    <Screen title="Search" testID="screen-search">
      <TextInput
        accessibilityLabel="Search groceries"
        testID="search-input"
        placeholder="Search groceries"
        value={query}
        onChangeText={setQuery}
        maxLength={120}
        returnKeyType="done"
        onSubmitEditing={() => Keyboard.dismiss()}
        style={styles.input}
      />
      <Text style={styles.muted}>Catalog search is not available in this foundation build.</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss keyboard"
        onPress={() => Keyboard.dismiss()}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Done</Text>
      </Pressable>
    </Screen>
  );
}
