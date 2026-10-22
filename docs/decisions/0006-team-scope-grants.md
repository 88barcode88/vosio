# Tým, instalační správce a dynamické granty

Uživatel potvrdil samostatného správce instalace i zakladatele projektu a pro
Tým vybral variantu A se seznamem vlevo a detailem vpravo. Stávající projektový
zakladatel se automaticky nestává instalačním správcem. Explicitní neveřejný
registr správců nemá veřejný bootstrap a role sama nepřidává přístup k obsahu.

Klient a složka dostávají výslovný dynamický grant nad stávajícím recording
resolverem. Snapshot dnešních ID by nesplnil dohodnuté budoucí sdílení. Vyhodnocuje
se aktuální zařazení, aktuální autorita autora grantu a pevná projektová hranice.
Soukromé nahrávky se podle posledního upřesnění vždy vynechají. Samotné zařazení
bez grantu nic nesdílí; nejsilnější zbývající platná cesta určuje efektivní roli.

Původní sharing lock serializuje grant, revokaci a assignment. Operátorská změna
registru musí použít stejný lock. Zakladatel nemůže přes vlastní klienta/složku
sdílet projekt jiného zakladatele. Scope pozvánky rozšiřují původní tokenový tok;
čekání na přijetí není grant a accepted-token replay odvolaný grant neobnoví.

API, přesné chování přesunů, preflight a návrat jsou v [team-access](../api/team-access.md).
Lokální source/SQL proof nepotvrzuje nasazení, Supabase HTTP ani uživatelskou akceptaci.
