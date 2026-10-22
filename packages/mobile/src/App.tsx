import { StyleSheet, Text, View } from "react-native";
import { greetingText } from "./greeting";
import { platformName } from "./platformName";

export function App() {
  return (
    <View style={styles.container}>
      <Text>{`${greetingText} (${platformName})`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
