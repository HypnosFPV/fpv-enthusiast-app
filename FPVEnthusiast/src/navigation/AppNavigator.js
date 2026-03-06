// src/navigation/AppNavigator.js  ← UPDATED
// NOTE: Your app's PRIMARY routing is Expo Router (app/(tabs)/).
// This file is the legacy React Navigation setup — keep it in sync
// but the Expo Router _layout.tsx is what actually drives the tab bar.

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import HomeScreen        from '../screens/HomeScreen';
import ChallengesScreen  from '../screens/ChallengesScreen';
import MapScreen         from '../screens/MapScreen';
import MarketplaceScreen from '../screens/MarketplaceScreen';
import ProfileScreen     from '../screens/ProfileScreen';

// ── Uncomment these two lines once you create the screen files ────────────────
// import SearchScreen        from '../screens/SearchScreen';
// import NotificationsScreen from '../screens/NotificationsScreen';

const Tab = createBottomTabNavigator();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ focused, color, size }) => {
          let iconName = 'home-outline';


            if      (route.name === 'Feed')          iconName = focused ? 'home'              : 'home-outline';
            else if (route.name === 'Search')        iconName = focused ? 'search'            : 'search-outline';
            else if (route.name === 'Challenges')    iconName = focused ? 'trophy'            : 'trophy-outline';
            else if (route.name === 'Map')           iconName = focused ? 'map'               : 'map-outline';
            else if (route.name === 'Marketplace')   iconName = focused ? 'cart'              : 'cart-outline';
            else if (route.name === 'Notifications') iconName = focused ? 'notifications'     : 'notifications-outline';
            else if (route.name === 'Profile')       iconName = focused ? 'person'            : 'person-outline';

            return <Ionicons name={iconName} size={size} color={color} />;
          },
          tabBarActiveTintColor:   '#ff4500',
          tabBarInactiveTintColor: '#888',
          tabBarStyle: {
            backgroundColor: '#111111',
            borderTopColor:  '#222222',
            paddingBottom:   5,
            height:          60,
          },
          headerStyle:      { backgroundColor: '#111111' },
          headerTintColor:  '#ffffff',
          headerTitleStyle: { fontWeight: 'bold' },
        })}
      >
        <Tab.Screen name="Feed"        component={HomeScreen}        />
        {/* Uncomment after creating SearchScreen and NotificationsScreen: */}
        {/* <Tab.Screen name="Search"        component={SearchScreen}        /> */}
        <Tab.Screen name="Challenges"  component={ChallengesScreen}  />
        <Tab.Screen name="Map"         component={MapScreen}         />
        <Tab.Screen name="Marketplace" component={MarketplaceScreen} />
        {/* <Tab.Screen name="Notifications" component={NotificationsScreen} /> */}
        <Tab.Screen name="Profile"     component={ProfileScreen}     />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
