import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import HomeScreen from '../screens/HomeScreen';
import ChallengesScreen from '../screens/ChallengesScreen';
import MapScreen from '../screens/MapScreen';
import MarketplaceScreen from '../screens/MarketplaceScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Tab = createBottomTabNavigator();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ focused, color, size }) => {
            let iconName;
            if (route.name === 'Feed') iconName = focused ? 'home' : 'home-outline';
            else if (route.name === 'Challenges') iconName = focused ? 'trophy' : 'trophy-outline';
            else if (route.name === 'Map') iconName = focused ? 'map' : 'map-outline';
            else if (route.name === 'Marketplace') iconName = focused ? 'cart' : 'cart-outline';
            else if (route.name === 'Profile') iconName = focused ? 'person' : 'person-outline';
            return <Ionicons name={iconName} size={size} color={color} />;
          },
          tabBarActiveTintColor: '#ff4500',
          tabBarInactiveTintColor: '#888',
          tabBarStyle: {
            backgroundColor: '#111111',
            borderTopColor: '#222222',
            paddingBottom: 5,
            height: 60,
          },
          headerStyle: { backgroundColor: '#111111' },
          headerTintColor: '#ffffff',
          headerTitleStyle: { fontWeight: 'bold' },
        })}
      >
        <Tab.Screen name="Feed" component={HomeScreen} />
        <Tab.Screen name="Challenges" component={ChallengesScreen} />
        <Tab.Screen name="Map" component={MapScreen} />
        <Tab.Screen name="Marketplace" component={MarketplaceScreen} />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
