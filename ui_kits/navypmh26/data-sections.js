/* Sample data for the built-out sections (Постанова 1808 + Алгоритми 377).
   Faithful to the real data shapes (resolution.js / algorithms.js); abridged. */

/* ---------- Алгоритми та правила (наказ № 377) ---------- */
window.KIT_ALG = {
  records_count: 612,
  documents_count: 4,
  effective: "15.05.2026",
  documents: [
    { id: "order-377", short_title: "Наказ 377", title: "Наказ НСЗУ № 377 — перелік медичних послуг", description: "Базовий перелік кодів НК 025 та амбулаторно-асоційованих станів.", pages: 48, codes_count: 612, href: "#" },
    { id: "appendix-1", short_title: "Додаток 1", title: "Додаток 1 — діагнози для дітей", description: "Стани, що застосовуються до пацієнтів віком до 18 років.", pages: 12, codes_count: 188, href: "#" },
    { id: "appendix-2", short_title: "Додаток 2", title: "Додаток 2 — амбулаторно-асоційовані стани", description: "Перелік станів, які ведуться амбулаторно.", pages: 9, codes_count: 142, href: "#" },
    { id: "comparison", short_title: "Порівняння", title: "Порівняльна таблиця змін", description: "Зміни до переліку станом на 15.05.2026.", pages: 6, codes_count: 0, href: "#" },
  ],
  comparison_href: "#",
  records: [
    { id: "a08-0", code: "A08.0", name: "Ротавірусний ентерит", source_id: "order-377", source_title: "Наказ 377", document_title: "Наказ НСЗУ № 377", page: 7, packages: ["4", "9"], children: true, adults: true, comparison_page: 2 },
    { id: "z00-1", code: "Z00.1", name: "Плановий огляд здоров'я дитини", source_id: "appendix-1", source_title: "Додаток 1", document_title: "Додаток 1 — діагнози для дітей", page: 3, packages: ["1"], children: true, adults: false, comparison_page: null },
    { id: "j06-9", code: "J06.9", name: "Гостра інфекція верхніх дихальних шляхів, неуточнена", source_id: "order-377", source_title: "Наказ 377", document_title: "Наказ НСЗУ № 377", page: 11, packages: ["1", "9"], children: true, adults: true, comparison_page: 3 },
    { id: "e11", code: "E11", name: "Цукровий діабет 2 типу", source_id: "order-377", source_title: "Наказ 377", document_title: "Наказ НСЗУ № 377", page: 14, packages: ["1"], children: false, adults: true, comparison_page: null },
    { id: "i10", code: "I10", name: "Есенціальна (первинна) гіпертензія", source_id: "appendix-2", source_title: "Додаток 2", document_title: "Додаток 2 — амбулаторно-асоційовані стани", page: 5, packages: ["1"], children: false, adults: true, comparison_page: 4 },
    { id: "z34-0", code: "Z34.0", name: "Спостереження за перебігом нормальної вагітності", source_id: "order-377", source_title: "Наказ 377", document_title: "Наказ НСЗУ № 377", page: 22, packages: ["10"], children: false, adults: true, comparison_page: null },
    { id: "c50", code: "C50", name: "Злоякісне новоутворення молочної залози", source_id: "order-377", source_title: "Наказ 377", document_title: "Наказ НСЗУ № 377", page: 28, packages: ["35"], children: false, adults: true, comparison_page: 5, pkg4_only: "" },
    { id: "f32", code: "F32", name: "Депресивний епізод", source_id: "appendix-2", source_title: "Додаток 2", document_title: "Додаток 2 — амбулаторно-асоційовані стани", page: 6, packages: ["1"], children: false, adults: true, comparison_page: null },
  ],
};

/* ---------- Постанова і Порядок № 1808 ---------- */
window.KIT_RES = {
  document: { number: "1808", edition_date: "15.05.2026", source_href: "#", source_html_href: "#" },
  counts: { chapters: 9, appendices: 5, resolution_items: 24 },
  type_labels: {
    tariff: "Тариф", coefficient: "Коефіцієнт", payment: "Правило оплати",
    deadline: "Строк", definition: "Визначення", general: "Загальне положення",
  },
  nodes: [
    {
      id: "post-p4", kind: "part", legal_document: "Постанова", title: "Пункт 4 — строки укладення договорів",
      types: ["deadline", "payment"], page_start: 2, page_end: 2, package_numbers: [],
      items: [
        { id: "p4-1", marker: "4.", number: 4, page: 2, text: "4. Установити, що договори про медичне обслуговування населення за програмою медичних гарантій на 2026 рік укладаються до 1 липня 2026 року." },
        { id: "p4-2", marker: "4-1.", number: 41, page: 2, text: "4-1. Надавачам, які не уклали договір у строк, оплата за надані послуги не здійснюється до моменту укладення договору." },
      ],
      related_packages: [],
    },
    {
      id: "ch-tariff-prim", kind: "chapter", legal_document: "Порядок", title: "Глава 3 — тариф первинної медичної допомоги",
      types: ["tariff", "coefficient"], page_start: 8, page_end: 10, package_numbers: ["1"],
      items: [
        { id: "t-1", marker: "12.", number: 12, page: 8, text: "12. Тариф на оплату первинної медичної допомоги визначається як капітаційна ставка на одну особу, що обрала лікаря, з урахуванням вікових коефіцієнтів." },
        { id: "t-2", marker: "13.", number: 13, page: 9, text: "13. Базова капітаційна ставка на 2026 рік становить 1 654,40 гривні на рік за одну особу." },
        { id: "t-3", marker: "14.", number: 14, page: 9, text: "14. До базової ставки застосовуються вікові коефіцієнти: 0-5 років — 4,0; 6-17 років — 2,2; 18-39 років — 1,0; 40-64 роки — 1,2; 65 років і старше — 2,0." },
      ],
      related_packages: [{ number: "1", title: "Первинна медична допомога", related_document_ids: [4] }],
    },
    {
      id: "ch-palliative", kind: "chapter", legal_document: "Порядок", title: "Глава 7 — оплата паліативної допомоги",
      types: ["tariff", "payment"], page_start: 16, page_end: 17, package_numbers: ["23"],
      items: [
        { id: "pal-1", marker: "31.", number: 31, page: 16, text: "31. Оплата стаціонарної паліативної допомоги здійснюється за глобальною ставкою за пролікований випадок із застосуванням коефіцієнта інтенсивності догляду." },
        { id: "pal-2", marker: "32.", number: 32, page: 17, text: "32. Мобільна паліативна допомога оплачується за ставкою на один візит мультидисциплінарної команди до пацієнта." },
      ],
      related_packages: [{ number: "23", title: "Паліативна медична допомога у стаціонарних умовах", related_document_ids: [1, 2] }],
    },
    {
      id: "app-1", kind: "appendix", legal_document: "Порядок", title: "Додаток 1 — вагові коефіцієнти ДСГ",
      types: ["coefficient", "tariff"], page_start: 30, page_end: 34, package_numbers: [],
      rows: [
        { code: "O01", title: "Пологи без ускладнень", coeffs: ["0,84", "—", "—"] },
        { code: "O02", title: "Пологи з ускладненнями", coeffs: ["1,42", "—", "—"] },
        { code: "P03", title: "Новонароджений, інтенсивна терапія", coeffs: ["3,18", "1,40", "—"] },
        { code: "S72", title: "Перелом стегнової кістки", coeffs: ["2,05", "—", "1,30"] },
      ],
      related_packages: [],
    },
    {
      id: "def-1", kind: "part", legal_document: "Порядок", title: "Пункт 2 — визначення термінів",
      types: ["definition", "general"], page_start: 3, page_end: 4, package_numbers: [],
      items: [
        { id: "d-1", marker: "2.1.", number: 21, page: 3, text: "2.1. Глобальна ставка — фіксована сума, що сплачується надавачу за пролікований випадок незалежно від фактичних витрат." },
        { id: "d-2", marker: "2.2.", number: 22, page: 4, text: "2.2. Діагностично-споріднена група (ДСГ) — спосіб класифікації випадків стаціонарного лікування за схожістю клінічних характеристик і обсягу ресурсів." },
      ],
      related_packages: [],
    },
  ],
};
