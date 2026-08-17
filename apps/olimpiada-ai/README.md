# Olimpiada AI — Router modeli MVP

Cel: ograniczyć przepalanie kontekstu i tokenów przez wysyłanie zadania tylko do modeli, które są potrzebne.

## Tryby

- `SOLO` — jeden model.
- `DUEL` — dwa niezależne werdykty dla tematów wyższej wagi.
- `JURY` — cztery modele dla złożonych i wysokiego ryzyka decyzji.
- `AUTO` — router dobiera tryb deterministycznie.

## Role modeli w MVP

- ChatGPT — rozmowa, kontrola, audyt, fakt-check, przygotowanie wsadu.
- Claude — duży kod, architektura, długie dokumenty, złożone wykonanie.
- Perplexity — świeży research i źródła.
- Gemini — multimodalność / Google ecosystem / alternatywny werdykt.

## Co działa

1. Wpisujesz zadanie i opcjonalny kontekst.
2. Router punktuje modele po rodzaju zadania.
3. AUTO wybiera SOLO / DUEL / JURY.
4. Kontekst jest ograniczany do maks. 2400 znaków.
5. Powstaje gotowa paczka do przekazania wybranemu modelowi.
6. Interfejs potrafi skopiować paczkę do schowka.

## Czego MVP celowo NIE robi

- nie przechowuje kluczy API;
- nie wysyła promptów do dostawców modeli;
- nie zapisuje rozmów;
- nie wykonuje automatycznego deployu;
- nie deklaruje oszczędności tokenów bez pomiaru.

## Test

W katalogu modułu:

```bash
node --test tests/router.test.mjs
```

## Warunek kolejnego etapu

Najpierw przeprowadzić ręczny test 5 realnych zadań i sprawdzić, czy routing modelu oraz trybu jest sensowny. Dopiero potem dodać backendowe adaptery modeli i pomiar kosztu/tokenów.
