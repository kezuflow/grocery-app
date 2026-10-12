import { Tabs } from "expo-router";
import { tokens } from "../../lib/tokens";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarIcon: () => null,
        tabBarActiveTintColor: tokens.action,
        tabBarInactiveTintColor: tokens.muted,
        tabBarHideOnKeyboard: true,
        animation: "none",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarAccessibilityLabel: "Home tab",
          tabBarButtonTestID: "tab-home",
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarAccessibilityLabel: "Search tab",
          tabBarButtonTestID: "tab-search",
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: "Cart",
          tabBarAccessibilityLabel: "Cart tab",
          tabBarButtonTestID: "tab-cart",
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: "Orders",
          tabBarAccessibilityLabel: "Orders tab",
          tabBarButtonTestID: "tab-orders",
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarAccessibilityLabel: "Account tab",
          tabBarButtonTestID: "tab-account",
        }}
      />
    </Tabs>
  );
}
