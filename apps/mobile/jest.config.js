module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/test'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  setupFiles: ['<rootDir>/test/setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|expo-[^/]*|@expo(nent)?/.*|react-navigation|@react-navigation/.*|react-native-svg|@signaldesk/.*)/)',
  ],
};
