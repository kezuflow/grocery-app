import { Text } from "react-native";
import { Screen, styles } from "../../components/screen";
export default function Orders() {
  return (
    <Screen title="Orders" testID="screen-orders">
      <Text style={styles.text}>Your orders are private.</Text>
      <Text style={styles.muted}>
        Sign-in and order history are not available in this foundation build.
      </Text>
    </Screen>
  );
}
