import { Tabs } from "expo-router";
import { SymbolView } from "expo-symbols";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";

const icon = (name: ComponentProps<typeof SymbolView>["name"], color: ColorValue) => (
  <SymbolView name={name} tintColor={color} size={23} />
);

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#183c26",
        tabBarInactiveTintColor: "#78867a",
        tabBarStyle: {
          backgroundColor: "#fff",
          borderTopColor: "#e9eee8",
          height: 68,
          paddingTop: 7,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600", paddingBottom: 4 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) =>
            icon({ ios: "house.fill", android: "home", web: "home" }, color),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color }) =>
            icon({ ios: "magnifyingglass", android: "search", web: "search" }, color),
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: "Cart",
          tabBarIcon: ({ color }) =>
            icon({ ios: "cart.fill", android: "shopping_cart", web: "shopping_cart" }, color),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: "Orders",
          tabBarIcon: ({ color }) =>
            icon({ ios: "bag.fill", android: "receipt_long", web: "receipt_long" }, color),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarIcon: ({ color }) =>
            icon({ ios: "person.crop.circle", android: "person", web: "person" }, color),
        }}
      />
    </Tabs>
  );
}
