import { StyleSheet, Text, View } from "react-native";
import { greetingText } from "./greeting";

export function App() {
  return (
    <View style={styles.container}>
      <Text>{greetingText}</Text>
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
