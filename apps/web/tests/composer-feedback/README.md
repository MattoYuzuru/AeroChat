# Mobile composer feedback regression

`feedback.mjs` извлекает без изменения production text send/submit/Enter/change
handlers и JSX-вызов `DirectComposerFeedback` из `ChatsPage.tsx`. Структурные
assertions проверяют, что вызов остаётся первым ребёнком реального composer form,
textarea связан с его уникальным ID, а прежние копии feedback подавлены при
активном composer. Компонент, React, LegacyAppShell и ChatsPage CSS настоящие;
auth/RTC, 50-message DOM и HTTP503 crypto-action adapter синтетические. Fixture
не проверяет ciphertext, backend или взаимодействие настоящих аккаунтов.

Versioned send state/ref, completion layout effect и programmatic draft helpers
также извлекаются из production source, как в отдельной composer regression.
Fixture предоставляет только контракт dependencies; send algorithm не заменяется
упрощённой копией. После503 проверяется освобождение versioned send lock.

Для direct/self проверяются 320/390/768 portrait и landscape, короткая/длинная
ошибка, ровно один отказ503, сохранение draft/focus, видимый alert внутри composer,
его отдельный bounded scroll, обычный Shift+Tab/Tab к feedback/textarea/actions,
textarea не уже140 CSS px, полезная history не ниже48 CSS px и отсутствие scroll
history/страницы от feedback reveal. Настоящий `onChange` очищает ошибку и
`aria-describedby`. Screenshot снимается до очистки ошибки. Любой пропуск или
ошибка завершает suite ненулевым exit code; browser/server закрываются в finally.

Запуск через общий heavy runner после frozen install; окружение задаёт
`PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE`, необязательные
`FEEDBACK_ARTIFACT_DIR` и `FEEDBACK_FIXTURE_PORT` (по умолчанию25174).
Полные message pages с реальной парой аккаунтов остаются отдельной приёмкой.
Физические iOS/Android keyboard, touch и native browser zoom этим не доказаны.
