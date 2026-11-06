# Mobile audit

Everything below was run on 6 November 2026 on one Apple Silicon Mac with 8 GB of memory and no Xcode. Anything not run says so.

## Readiness

**Android: a working app, tested end to end on an emulator. iOS: built from the same code and bundles cleanly, but has never run.
Neither platform has received a real push notification, or been on a real phone. Not ready for real subscribers.**

| Question                                            | Answer                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| Does the Android app work against the real backend? | **Yes**, on an Android 12 emulator, in Expo Go                             |
| Does an installable Android build compile?          | See [CI status](#ci-status)                                                |
| Does the iOS app run?                               | **Not known.** No Xcode here. JavaScript bundles, native project generates |
| Do real push notifications arrive?                  | **Not known.** Needs an Expo project and credentials only you can create   |
| Is the server side of push tested?                  | **Yes**, against a local stand-in for Expo's service                       |
| Ready for store submission?                         | **No.** Needs your accounts, a production API and legal review             |

## What ran

| Gate                                                                      | Result                                                                                                                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript across all four packages                                       | Pass                                                                                                                                             |
| ESLint, zero warnings allowed                                             | Pass                                                                                                                                             |
| Prettier                                                                  | Pass                                                                                                                                             |
| Shared logic tests                                                        | **@@UNIT@@**                                                                                                                                     |
| API integration tests, including 32 new ones for native clients           | **178 of 178**                                                                                                                                   |
| Web end-to-end tests, confirming the shared-code refactor broke nothing   | **77 of 77**                                                                                                                                     |
| Mobile component and logic tests                                          | **56 of 56**                                                                                                                                     |
| Emulator journeys in the real app against a real API, worker and database | **@@JOURNEYS@@**                                                                                                                                 |
| Expo project health check                                                 | 20 of 20                                                                                                                                         |
| JavaScript bundle for Android and iOS, production settings                | Pass                                                                                                                                             |
| Secret scan of every tracked file                                         | Clean                                                                                                                                            |
| `npm audit --omit=dev`, high or critical                                  | **0**                                                                                                                                            |
| `npm audit --omit=dev`, moderate or low                                   | 22, all `minimatch` and `deepmerge` in Expo's and Jest's command-line tools. No fix exists without downgrading Expo. None of it ships in the app |

## Not run

| Gap                                        | Why                                                                                                                  | What to do                                                                                                                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Anything on iOS**                        | No Xcode on this machine                                                                                             | Run the `ios-build` workflow, then test on a Mac. Expect to find issues. Three iOS-specific code paths have never executed: keyboard handling, the page sheet, and the WebSocket header |
| **A real push notification on any device** | Needs an Expo project, Firebase and Apple credentials                                                                | See [MOBILE.md](MOBILE.md). Then test delivery, tapping from closed, and hidden previews on real phones                                                                                 |
| **Tapping a notification**                 | Same. Logic is unit tested, and deep links are tested through the system's own link handling                         | As above                                                                                                                                                                                |
| **A real phone**                           | None connected                                                                                                       | Android first, over Wi-Fi to your computer                                                                                                                                              |
| **iPhone screens**                         | The "iPhone size" runs are Android drawing at those logical sizes. They check layout only, and are **not** iOS tests | Xcode simulators                                                                                                                                                                        |
| **Android 13 and later**                   | The only system image here is Android 12, which does not ask for notification permission                             | Test the permission prompt on a current phone                                                                                                                                           |
| **Slow networks, low-end phones, battery** | Emulator on a laptop                                                                                                 | Real devices on mobile data                                                                                                                                                             |
| **Screen readers**                         | Labels and roles are set, and checked in the accessibility tree. No person has used it                               | TalkBack and VoiceOver pass                                                                                                                                                             |
| **Live delivery time on a phone**          | The driver reads the screen too slowly to give a meaningful number                                                   | Measure on a real device                                                                                                                                                                |
| **A store review**                         | Needs your accounts                                                                                                  | See [MOBILE.md](MOBILE.md)                                                                                                                                                              |

## Defects found and fixed

| Severity | Found by                 | Defect                                                                                                                                                                                                                       | Fix                                                                                    |
| -------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Critical | Emulator journey         | **Every list screen was blank on Android.** On Android a scroll view renders inside its refresh control, and my wrapper dropped it. Typecheck and unit tests could not see this                                              | The wrapper forwards everything                                                        |
| Critical | Starting the app         | Two versions of React in the workspace, which crashes a React Native app                                                                                                                                                     | One exact version across web and mobile                                                |
| High     | Emulator journey         | The app crashed at launch in Expo Go: the check for "am I in Expo Go" gave the wrong answer, so the push library loaded                                                                                                      | Uses Expo's own check                                                                  |
| High     | Emulator journey         | Signing out crashed, because the account screen was still on screen for a moment with no account                                                                                                                             | Renders nothing during that moment                                                     |
| High     | Emulator journey         | A half-written signal was lost on reopening the composer: an empty form overwrote the saved one before it had been read                                                                                                      | Nothing saves until restoring has finished                                             |
| High     | Emulator journey         | On Android the action sheets' buttons sat behind the keyboard, and the window did not resize                                                                                                                                 | Fixed the window setting, and moved every action button to a footer above the keyboard |
| High     | Developer review         | **Recovery codes could vanish before being saved.** Two-step turns on the moment the code is accepted, so the next account refresh moved on from the only screen that shows them. Going off to paste them would trigger that | The screen stays until "I have saved them" is pressed                                  |
| High     | Developer review         | **Alerts stopped silently after a forced sign-out**, such as a password reset, because the device registration went with the session                                                                                         | Re-registers on the next start, unless the person turned alerts off                    |
| High     | Developer review         | iOS: the standard keyboard-avoiding view measures from its parent, so it would have come up short under a header or in a sheet. **Fix has not run on iOS**                                                                   | Measures from the bottom of the screen                                                 |
| Medium   | UI review                | A cancelled signal was headed "Closed: T-0005" in the feed, on web too                                                                                                                                                       | "Cancelled:" and "Expired:", shared by both                                            |
| Medium   | Screen sweep, large text | Tab labels were cut off with larger system text                                                                                                                                                                              | Labels no longer scale, because the icons say the same                                 |
| Medium   | Screen sweep             | Toggle switches were 39 dp tall                                                                                                                                                                                              | The whole row is the target                                                            |
| Medium   | First-time user review   | A first sign-in asked for the temporary password again, seconds after typing it                                                                                                                                              | Remembered in memory for that one step                                                 |
| Medium   | UI review                | An alert banner announced what was already on screen, including what the administrator had just done                                                                                                                         | Quiet on the same trade, in the feed and in the composer, except for priority          |
| Medium   | Security review          | Android backups were allowed, and the app declared a Face ID use it does not have                                                                                                                                            | Both removed                                                                           |
| Medium   | Architect review         | Response types and date formatting were copied between apps                                                                                                                                                                  | Moved to the shared package                                                            |
| Low      | UI review                | Badges sat above the line, and targets were smaller than other levels                                                                                                                                                        | Aligned and consistent                                                                 |
| Low      | Developer review         | All icon fonts shipped, and the "Published" screen kept polling after it had finished                                                                                                                                        | One font, and polling stops                                                            |
| Low      | Tests                    | The test suite's offline check could not actually cut a connection, because `adb reverse` ignores Wi-Fi                                                                                                                      | A proxy in the test server really drops every socket                                   |

No Critical or High defect is known to be open. Two High fixes depend on things that could not run here: the iOS keyboard change, and the push re-registration, which is covered by logic tests only.

## The five reviews

**Senior developer.** Read every screen and library file against how it behaves on a device. Found the recovery-code race, the silent loss of alerts and the leftover polling. Remaining: Expo messages are sent one per request. That is simple and correct but will not suit tens of thousands of devices, and the client limits are unmeasured.

**Software architect.** The app owns no trade logic: `composeSignal`, `previewExit`, `trailStopPrice`, formatting and validation come from `packages/domain`, and web now uses the same functions, so a preview and the server cannot disagree. Native push is a channel in the existing pipeline, not a parallel one. Bearer sessions use the same table and guard as cookies. Remaining: no offline cache of private data by design, so a cold start with no network shows an error rather than old signals. That is the right default for trading, and worth confirming with you.

**QA engineer.** Journeys drive the real app through the system's accessibility tree, with no test hooks compiled in. They cover wrong passwords, first sign-in for both roles, live delivery with no refresh, a connection really being cut and caught up exactly once and in order, backgrounding, deep links, expiry mid-session, renewal, revocation, every main trade action with exact server-side checks on the money, duplicate protection, invalid levels, drafts, and subscriber management. Remaining: everything in [Not run](#not-run).

**UI/UX expert.** Reviewed screenshots of every major screen in dark and light, at six sizes, and with large text. Findings are in the table above. The checks also assert that nothing runs off screen and that touch targets are at least 40 dp. Remaining: dates are typed as `YYYY-MM-DD` where a date picker would be friendlier (Medium, open), the status bar dims behind sheets on Android (Low, open), and there is no haptic or motion review on real hardware.

**First-time user.** Walked through as a subscriber and as an administrator with no prior knowledge. A new subscriber sees why to change their password, an empty feed that explains itself, and a notification prompt only after arriving. An administrator can publish from the first screen in about four taps. Rough edges: "Desk" and "Trades" are not obviously different at first, and instruments can only be added on the web, which the app explains under More.

## Open items

| Severity | Item                                                                             |
| -------- | -------------------------------------------------------------------------------- |
| Medium   | Date fields are typed rather than picked                                         |
| Medium   | Expo messages are not batched                                                    |
| Medium   | No self-service account deletion. May be required by the stores                  |
| Medium   | No screen reader pass                                                            |
| Low      | Status bar dims behind sheets on Android                                         |
| Low      | The exit-time override is on the web only. On a phone an exit is recorded as now |

## Blockers that are yours

1. **Legal review.** Unchanged from [FINAL_AUDIT.md](FINAL_AUDIT.md): the placeholder legal text and regulatory position must be resolved before real subscribers. A native app adds store policies to that.
2. **Accounts and credentials:** Expo, Firebase, Apple Developer, Google Play. See [MOBILE.md](MOBILE.md).
3. **A production HTTPS API.** The deployment files remain unexercised.
4. **Testing on iOS and real phones**, which needs a Mac with Xcode and the devices.

## CI status

@@CI@@
