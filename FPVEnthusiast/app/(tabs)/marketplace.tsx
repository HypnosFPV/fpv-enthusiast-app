import { View, Text, StyleSheet } from 'react-native';
export default function MarketplaceScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>🛒 Marketplace Coming Soon</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0a0a0a' },
  text: { color: '#ffffff', fontSize: 18 },
});
