import { Text } from "react-native";
import { Screen, styles } from "../../components/screen";
export default function Account() {
  return (
    <Screen title="Account" testID="screen-account">
      <Text style={styles.text}>Your FreshMarkets account.</Text>
      <Text style={styles.muted}>
        Sign-in is not available in this foundation build. Your existing account and history remain
        with FreshMarkets.
      </Text>
    </Screen>
  );
}
