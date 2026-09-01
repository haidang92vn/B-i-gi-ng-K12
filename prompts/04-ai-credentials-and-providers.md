# Codex Prompt 04 — Teacher AI credentials and provider adapter

Implement Milestone 04.

Requirements:
- encrypted per-user AI credentials;
- browser never receives stored plaintext key;
- provider adapter interface independent from course domain logic;
- Mock provider preserved for tests;
- implement one real provider behind the adapter;
- structured JSON output validated before it enters the course model;
- safe retry/error handling;
- log redaction tests/guards.

Do not put provider SDK calls directly inside route handlers or UI code.
