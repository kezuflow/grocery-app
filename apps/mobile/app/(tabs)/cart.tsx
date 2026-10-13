import { Text } from "react-native";
import { Screen, styles } from "../../components/screen";
export default function Cart() {
  return (
    <Screen title="Cart" testID="screen-cart">
      <Text style={styles.text}>Your cart needs a connected account.</Text>
      <Text style={styles.muted}>
        Account connection and cart access are not available in this foundation build.
      </Text>
    </Screen>
  );
}
