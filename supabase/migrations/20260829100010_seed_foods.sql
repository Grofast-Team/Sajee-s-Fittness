-- 0001_foods.sql — food seed data
--
-- ⚠️ DATA PROVENANCE — READ BEFORE PRODUCTION USE
--
-- These are widely-published approximate composition values for common Indian
-- foods, included so the app is usable from the first run. They are marked
-- `is_verified = false`, `data_confidence = 'medium'` and
-- `source = 'seed_approximate'` for exactly that reason.
--
-- Before launch, each row must be reconciled against a primary source —
-- IFCT 2017 (NIN/ICMR) for Indian foods, USDA FoodData Central otherwise — and
-- then flipped to is_verified = true with the real source string and year.
-- The `source`, `source_year`, `data_confidence` and `is_verified` columns exist
-- precisely so that unverified data can never masquerade as verified data.
--
-- Composition of cooked mixed dishes (sambar, kuzhambu, biryani) varies enormously
-- between households, mostly through oil. Treat those rows as starting points
-- that users will correct, which is what the correction-learning pipeline is for.

insert into public.foods
  (slug, name, name_local, category, cuisine, region, food_state,
   is_vegetarian, is_vegan, contains_egg, contains_dairy, allergens,
   kcal_per_100g, protein_per_100g, carb_per_100g, fat_per_100g, fibre_per_100g,
   default_serving_g, typical_cost_per_100g, source, source_year, data_confidence)
values
  -- ---- South Indian staples ------------------------------------------------
  ('idli', 'Idli', 'இட்லி', 'grain_dish', 'indian', 'south', 'cooked',
   true, true, false, false, '{}', 128, 3.4, 26.0, 0.6, 1.0, 40, 2.50, 'seed_approximate', 2024, 'medium'),
  ('dosa-plain', 'Dosa (plain)', 'தோசை', 'grain_dish', 'indian', 'south', 'cooked',
   true, true, false, false, '{}', 168, 3.9, 29.0, 3.7, 1.2, 80, 3.50, 'seed_approximate', 2024, 'medium'),
  ('masala-dosa', 'Masala dosa', 'மசாலா தோசை', 'grain_dish', 'indian', 'south', 'cooked',
   true, false, false, true, '{}', 190, 4.2, 30.0, 6.0, 2.0, 150, 5.00, 'seed_approximate', 2024, 'low'),
  ('sambar', 'Sambar', 'சாம்பார்', 'curry', 'indian', 'south', 'cooked',
   true, true, false, false, '{}', 85, 3.8, 11.0, 2.8, 2.5, 150, 2.00, 'seed_approximate', 2024, 'low'),
  ('rasam', 'Rasam', 'ரசம்', 'soup', 'indian', 'south', 'cooked',
   true, true, false, false, '{}', 40, 1.5, 5.5, 1.4, 1.0, 150, 1.50, 'seed_approximate', 2024, 'low'),
  ('coconut-chutney', 'Coconut chutney', 'தேங்காய் சட்னி', 'condiment', 'indian', 'south', 'cooked',
   true, true, false, false, '{}', 195, 3.0, 8.0, 17.0, 4.0, 40, 3.00, 'seed_approximate', 2024, 'low'),
  ('pongal-ven', 'Ven pongal', 'வெண் பொங்கல்', 'grain_dish', 'indian', 'south', 'cooked',
   true, false, false, true, '{}', 165, 4.5, 24.0, 5.5, 1.5, 200, 3.00, 'seed_approximate', 2024, 'low'),
  ('upma', 'Upma', 'உப்புமா', 'grain_dish', 'indian', 'south', 'cooked',
   true, true, false, false, '{gluten}', 145, 3.5, 22.0, 4.5, 1.8, 180, 2.50, 'seed_approximate', 2024, 'low'),
  ('curd-rice', 'Curd rice', 'தயிர் சாதம்', 'grain_dish', 'indian', 'south', 'cooked',
   true, false, false, true, '{dairy}', 120, 3.5, 19.0, 3.0, 0.5, 200, 3.00, 'seed_approximate', 2024, 'low'),
  ('lemon-rice', 'Lemon rice', 'எலுமிச்சை சாதம்', 'grain_dish', 'indian', 'south', 'cooked',
   true, true, false, false, '{peanuts}', 175, 3.2, 28.0, 5.5, 1.2, 200, 2.50, 'seed_approximate', 2024, 'low'),
  ('sundal', 'Sundal (chana)', 'சுண்டல்', 'legume_dish', 'indian', 'south', 'cooked',
   true, true, false, false, '{}', 140, 7.0, 20.0, 3.5, 6.0, 100, 3.00, 'seed_approximate', 2024, 'medium'),
  ('idiyappam', 'Idiyappam', 'இடியாப்பம்', 'grain_dish', 'indian', 'south', 'cooked',
   true, true, false, false, '{}', 130, 2.5, 28.0, 0.5, 0.8, 60, 3.00, 'seed_approximate', 2024, 'low'),

  -- ---- North Indian / pan-Indian -------------------------------------------
  ('chapati', 'Chapati / Roti', 'रोटी', 'grain_dish', 'indian', 'north', 'cooked',
   true, true, false, false, '{gluten}', 250, 8.0, 46.0, 3.5, 5.0, 40, 2.50, 'seed_approximate', 2024, 'medium'),
  ('paratha-plain', 'Paratha (plain)', 'पराठा', 'grain_dish', 'indian', 'north', 'cooked',
   true, false, false, true, '{gluten}', 320, 7.0, 45.0, 12.0, 4.0, 60, 4.00, 'seed_approximate', 2024, 'low'),
  ('dal-tadka', 'Dal (tadka)', 'दाल तड़का', 'curry', 'indian', 'north', 'cooked',
   true, true, false, false, '{}', 120, 6.0, 15.0, 4.0, 4.0, 150, 2.50, 'seed_approximate', 2024, 'low'),
  ('rajma', 'Rajma curry', 'राजमा', 'curry', 'indian', 'north', 'cooked',
   true, true, false, false, '{}', 130, 7.0, 19.0, 3.0, 6.5, 150, 3.50, 'seed_approximate', 2024, 'medium'),
  ('chole', 'Chole', 'छोले', 'curry', 'indian', 'north', 'cooked',
   true, true, false, false, '{}', 155, 7.5, 21.0, 4.5, 7.0, 150, 3.50, 'seed_approximate', 2024, 'medium'),
  ('paneer-butter-masala', 'Paneer butter masala', 'पनीर बटर मसाला', 'curry', 'indian', 'north', 'cooked',
   true, false, false, true, '{dairy,nuts}', 245, 9.0, 10.0, 19.0, 2.0, 150, 12.00, 'seed_approximate', 2024, 'low'),
  ('chicken-biryani', 'Chicken biryani', 'बिरयानी', 'grain_dish', 'indian', null, 'cooked',
   false, false, false, true, '{dairy}', 190, 9.0, 24.0, 6.5, 1.5, 300, 10.00, 'seed_approximate', 2024, 'low'),
  ('poha', 'Poha', 'पोहा', 'grain_dish', 'indian', 'west', 'cooked',
   true, true, false, false, '{peanuts}', 130, 2.5, 24.0, 3.0, 1.2, 180, 2.00, 'seed_approximate', 2024, 'low'),

  -- ---- Staples (raw vs cooked kept strictly separate) ----------------------
  ('rice-white-raw', 'Rice, white (raw)', null, 'grain', 'indian', null, 'raw',
   true, true, false, false, '{}', 345, 6.8, 78.0, 0.5, 0.6, 60, 0.60, 'seed_approximate', 2024, 'medium'),
  ('rice-white-cooked', 'Rice, white (cooked)', 'சாதம்', 'grain', 'indian', null, 'cooked',
   true, true, false, false, '{}', 130, 2.6, 28.0, 0.2, 0.3, 150, 0.25, 'seed_approximate', 2024, 'medium'),
  ('brown-rice-cooked', 'Brown rice (cooked)', null, 'grain', 'indian', null, 'cooked',
   true, true, false, false, '{}', 123, 2.7, 26.0, 1.0, 1.6, 150, 0.45, 'seed_approximate', 2024, 'medium'),
  ('ragi-flour', 'Ragi flour', 'ராகி மாவு', 'grain', 'indian', 'south', 'dry',
   true, true, false, false, '{}', 330, 7.3, 72.0, 1.3, 11.5, 40, 1.20, 'seed_approximate', 2024, 'medium'),
  ('wheat-flour-atta', 'Wheat flour (atta)', 'आटा', 'grain', 'indian', null, 'dry',
   true, true, false, false, '{gluten}', 340, 12.0, 69.0, 1.7, 11.0, 40, 0.50, 'seed_approximate', 2024, 'medium'),
  ('toor-dal-raw', 'Toor dal (raw)', 'துவரம் பருப்பு', 'legume', 'indian', null, 'raw',
   true, true, false, false, '{}', 335, 22.0, 57.0, 1.7, 15.0, 40, 1.40, 'seed_approximate', 2024, 'medium'),
  ('moong-dal-raw', 'Moong dal (raw)', 'பாசிப் பருப்பு', 'legume', 'indian', null, 'raw',
   true, true, false, false, '{}', 345, 24.0, 59.0, 1.2, 16.0, 40, 1.50, 'seed_approximate', 2024, 'medium'),
  ('chana-black-raw', 'Kala chana (raw)', 'கொண்டைக்கடலை', 'legume', 'indian', null, 'raw',
   true, true, false, false, '{}', 360, 20.0, 61.0, 5.0, 17.0, 40, 1.00, 'seed_approximate', 2024, 'medium'),
  ('soya-chunks', 'Soya chunks (dry)', null, 'legume', 'indian', null, 'dry',
   true, true, false, false, '{soy}', 345, 52.0, 33.0, 0.5, 13.0, 30, 1.60, 'seed_approximate', 2024, 'medium'),

  -- ---- Protein sources -----------------------------------------------------
  ('egg-whole-boiled', 'Egg, boiled', 'முட்டை', 'protein', null, null, 'cooked',
   false, false, true, false, '{egg}', 155, 13.0, 1.1, 11.0, 0, 50, 1.40, 'seed_approximate', 2024, 'high'),
  ('egg-white', 'Egg white', null, 'protein', null, null, 'cooked',
   false, false, true, false, '{egg}', 52, 11.0, 0.7, 0.2, 0, 33, 1.40, 'seed_approximate', 2024, 'high'),
  ('chicken-breast-raw', 'Chicken breast (raw)', null, 'protein', null, null, 'raw',
   false, false, false, false, '{}', 120, 22.5, 0, 2.6, 0, 100, 2.80, 'seed_approximate', 2024, 'high'),
  ('chicken-curry', 'Chicken curry', 'கோழி குழம்பு', 'curry', 'indian', null, 'cooked',
   false, false, false, false, '{}', 180, 16.0, 4.0, 11.0, 1.0, 150, 6.00, 'seed_approximate', 2024, 'low'),
  ('fish-curry', 'Fish curry', 'மீன் குழம்பு', 'curry', 'indian', 'south', 'cooked',
   false, false, false, false, '{fish}', 145, 15.0, 4.0, 7.5, 1.0, 150, 5.50, 'seed_approximate', 2024, 'low'),
  ('paneer', 'Paneer', 'पनीर', 'dairy', 'indian', null, 'as_sold',
   true, false, false, true, '{dairy}', 265, 18.0, 3.5, 20.0, 0, 100, 8.00, 'seed_approximate', 2024, 'medium'),
  ('curd-plain', 'Curd (dahi)', 'தயிர்', 'dairy', 'indian', null, 'as_sold',
   true, false, false, true, '{dairy}', 62, 3.4, 4.8, 3.3, 0, 150, 1.20, 'seed_approximate', 2024, 'medium'),
  ('milk-toned', 'Milk (toned)', 'पाल', 'dairy', 'indian', null, 'as_sold',
   true, false, false, true, '{dairy}', 58, 3.2, 4.8, 3.0, 0, 200, 0.60, 'seed_approximate', 2024, 'medium'),
  ('peanuts-roasted', 'Peanuts (roasted)', 'வேர்க்கடலை', 'nuts', null, null, 'cooked',
   true, true, false, false, '{peanuts}', 570, 25.0, 16.0, 49.0, 8.5, 30, 1.60, 'seed_approximate', 2024, 'medium'),

  -- ---- Vegetables and fruit ------------------------------------------------
  ('mixed-veg-sabzi', 'Mixed vegetable sabzi', null, 'vegetable_dish', 'indian', null, 'cooked',
   true, true, false, false, '{}', 90, 2.5, 10.0, 4.5, 3.5, 150, 2.00, 'seed_approximate', 2024, 'low'),
  ('spinach-cooked', 'Palak (cooked)', 'கீரை', 'vegetable', 'indian', null, 'cooked',
   true, true, false, false, '{}', 45, 3.0, 4.0, 2.0, 2.5, 100, 1.50, 'seed_approximate', 2024, 'medium'),
  ('banana', 'Banana', 'வாழைப்பழம்', 'fruit', null, null, 'raw',
   true, true, false, false, '{}', 89, 1.1, 23.0, 0.3, 2.6, 110, 0.80, 'seed_approximate', 2024, 'high'),
  ('apple', 'Apple', null, 'fruit', null, null, 'raw',
   true, true, false, false, '{}', 52, 0.3, 14.0, 0.2, 2.4, 150, 2.00, 'seed_approximate', 2024, 'high'),
  ('cucumber', 'Cucumber', 'வெள்ளரிக்காய்', 'vegetable', null, null, 'raw',
   true, true, false, false, '{}', 15, 0.7, 3.6, 0.1, 0.5, 100, 0.40, 'seed_approximate', 2024, 'high'),

  -- ---- Fats, drinks, and things people forget to log -----------------------
  ('oil-sunflower', 'Cooking oil', 'எண்ணெய்', 'fat', null, null, 'as_sold',
   true, true, false, false, '{}', 884, 0, 0, 100.0, 0, 5, 1.40, 'seed_approximate', 2024, 'high'),
  ('ghee', 'Ghee', 'நெய்', 'fat', 'indian', null, 'as_sold',
   true, false, false, true, '{dairy}', 900, 0, 0, 100.0, 0, 5, 6.00, 'seed_approximate', 2024, 'high'),
  ('tea-with-milk-sugar', 'Tea with milk and sugar', 'சாய்', 'beverage', 'indian', null, 'cooked',
   true, false, false, true, '{dairy}', 62, 1.4, 9.0, 2.0, 0, 150, 0.80, 'seed_approximate', 2024, 'low'),
  ('coffee-with-milk-sugar', 'Filter coffee', 'காபி', 'beverage', 'indian', 'south', 'cooked',
   true, false, false, true, '{dairy}', 70, 1.6, 9.5, 2.5, 0, 150, 1.20, 'seed_approximate', 2024, 'low'),
  ('cola', 'Soft drink (cola)', null, 'beverage', null, null, 'as_sold',
   true, true, false, false, '{}', 42, 0, 10.6, 0, 0, 330, 1.20, 'seed_approximate', 2024, 'high'),
  ('vada-medu', 'Medu vada', 'மெது வடை', 'snack', 'indian', 'south', 'cooked',
   true, true, false, false, '{}', 290, 7.0, 30.0, 15.0, 3.0, 45, 4.00, 'seed_approximate', 2024, 'low'),
  ('samosa', 'Samosa', 'समोसा', 'snack', 'indian', 'north', 'cooked',
   true, true, false, false, '{gluten}', 310, 5.0, 34.0, 17.0, 2.5, 60, 4.00, 'seed_approximate', 2024, 'low'),
  ('biscuit-marie', 'Marie biscuit', null, 'snack', null, null, 'as_sold',
   true, false, false, true, '{gluten,dairy}', 420, 7.0, 76.0, 10.0, 2.0, 5, 1.50, 'seed_approximate', 2024, 'medium')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Household serving units. This is what lets someone log "one katori of sambar"
-- without owning a scale, and what the portion engine falls back to when no
-- scale reading is available.
--
-- These grams are typical, not universal - kitchens differ - which is why they
-- resolve at medium confidence and produce a range rather than a point value.
-- ---------------------------------------------------------------------------
insert into public.food_servings (food_id, unit_label, grams, is_default, confidence, note)
select f.id, v.unit_label, v.grams, v.is_default, v.confidence::confidence_level, v.note
from (values
  ('idli',                'piece',      40.0,  true,  'high',   'One medium idli.'),
  ('dosa-plain',          'piece',      80.0,  true,  'medium', 'One medium dosa. Restaurant dosas are often much larger.'),
  ('masala-dosa',         'piece',     150.0,  true,  'low',    'Varies widely with the potato filling.'),
  ('chapati',             'piece',      40.0,  true,  'medium', 'One medium chapati, roughly 6 inches.'),
  ('paratha-plain',       'piece',      60.0,  true,  'low',    'Depends heavily on the ghee used.'),
  ('sambar',              'katori',    150.0,  true,  'medium', 'One standard katori.'),
  ('sambar',              'ladle',      80.0,  false, 'low',    'One serving ladle.'),
  ('rasam',               'katori',    150.0,  true,  'medium', null),
  ('dal-tadka',           'katori',    150.0,  true,  'medium', null),
  ('coconut-chutney',     'tablespoon',  20.0, true,  'medium', null),
  ('curd-plain',          'katori',    150.0,  true,  'medium', null),
  ('rice-white-cooked',   'katori',    150.0,  true,  'medium', 'One katori of cooked rice.'),
  ('rice-white-cooked',   'cup',       190.0,  false, 'medium', 'One standard cup, packed.'),
  ('rice-white-cooked',   'plate',     250.0,  false, 'low',    'A full plate portion. Varies a lot.'),
  ('curd-rice',           'katori',    200.0,  true,  'medium', null),
  ('milk-toned',          'glass',     200.0,  true,  'high',   null),
  ('tea-with-milk-sugar', 'cup',       150.0,  true,  'high',   null),
  ('coffee-with-milk-sugar','tumbler', 150.0,  true,  'high',   null),
  ('egg-whole-boiled',    'piece',      50.0,  true,  'high',   'One medium egg, without shell.'),
  ('banana',              'piece',     110.0,  true,  'medium', 'One medium banana, peeled.'),
  ('oil-sunflower',       'teaspoon',    5.0,  true,  'high',   'The most commonly under-logged item in any diet.'),
  ('oil-sunflower',       'tablespoon', 15.0,  false, 'high',   null),
  ('ghee',                'teaspoon',    5.0,  true,  'high',   null),
  ('peanuts-roasted',     'handful',    30.0,  true,  'low',    'Hand sizes vary; weigh these if you can.'),
  ('vada-medu',           'piece',      45.0,  true,  'medium', null),
  ('samosa',              'piece',      60.0,  true,  'medium', null),
  ('biscuit-marie',       'piece',       5.0,  true,  'high',   null),
  ('chicken-curry',       'katori',    150.0,  true,  'low',    'Oil content varies hugely between households.'),
  ('fish-curry',          'katori',    150.0,  true,  'low',    null),
  ('chicken-biryani',     'plate',     300.0,  true,  'low',    null),
  ('sundal',              'katori',    100.0,  true,  'medium', null),
  ('upma',                'katori',    180.0,  true,  'medium', null),
  ('poha',                'katori',    180.0,  true,  'medium', null),
  ('pongal-ven',          'katori',    200.0,  true,  'medium', null)
) as v(slug, unit_label, grams, is_default, confidence, note)
join public.foods f on f.slug = v.slug
on conflict (food_id, unit_label) do nothing;

-- ---------------------------------------------------------------------------
-- Aliases: regional names, transliterations and common misspellings all have to
-- resolve to the same record, or search is useless outside English.
-- ---------------------------------------------------------------------------
insert into public.food_aliases (food_id, alias, language)
select f.id, v.alias, v.lang
from (values
  ('dosa-plain', 'dosai', 'ta'), ('dosa-plain', 'thosai', 'ta'),
  ('dosa-plain', 'dosha', 'en'), ('dosa-plain', 'dose', 'kn'),
  ('idli', 'idly', 'en'), ('idli', 'iddli', 'en'), ('idli', 'itly', 'en'),
  ('sambar', 'sambhar', 'en'), ('sambar', 'saambar', 'en'), ('sambar', 'sambar dal', 'en'),
  ('curd-plain', 'yogurt', 'en'), ('curd-plain', 'dahi', 'hi'),
  ('curd-plain', 'thayir', 'ta'), ('curd-plain', 'mosaru', 'kn'), ('curd-plain', 'perugu', 'te'),
  ('curd-rice', 'thayir sadam', 'ta'), ('curd-rice', 'dahi chawal', 'hi'), ('curd-rice', 'bagala bath', 'kn'),
  ('chapati', 'roti', 'hi'), ('chapati', 'phulka', 'hi'), ('chapati', 'chappathi', 'en'),
  ('rice-white-cooked', 'sadam', 'ta'), ('rice-white-cooked', 'chawal', 'hi'),
  ('rice-white-cooked', 'anna', 'te'), ('rice-white-cooked', 'steamed rice', 'en'),
  ('vada-medu', 'vadai', 'ta'), ('vada-medu', 'ulundu vadai', 'ta'), ('vada-medu', 'wada', 'en'),
  ('pongal-ven', 'khara pongal', 'en'), ('pongal-ven', 'pongal', 'ta'),
  ('rasam', 'saaru', 'kn'), ('rasam', 'chaaru', 'te'), ('rasam', 'rassam', 'en'),
  ('chicken-curry', 'kozhi kuzhambu', 'ta'), ('chicken-curry', 'chicken gravy', 'en'),
  ('fish-curry', 'meen kuzhambu', 'ta'), ('fish-curry', 'fish gravy', 'en'),
  ('egg-whole-boiled', 'muttai', 'ta'), ('egg-whole-boiled', 'anda', 'hi'), ('egg-whole-boiled', 'boiled egg', 'en'),
  ('paneer', 'cottage cheese', 'en'),
  ('soya-chunks', 'meal maker', 'en'), ('soya-chunks', 'soya nuggets', 'en'),
  ('peanuts-roasted', 'groundnut', 'en'), ('peanuts-roasted', 'verkadalai', 'ta'), ('peanuts-roasted', 'moongphali', 'hi'),
  ('ragi-flour', 'finger millet', 'en'), ('ragi-flour', 'nachni', 'hi'), ('ragi-flour', 'kelvaragu', 'ta'),
  ('toor-dal-raw', 'arhar dal', 'hi'), ('toor-dal-raw', 'thuvaram paruppu', 'ta'), ('toor-dal-raw', 'pigeon pea', 'en'),
  ('moong-dal-raw', 'pasi paruppu', 'ta'), ('moong-dal-raw', 'green gram', 'en'),
  ('chana-black-raw', 'kondaikadalai', 'ta'), ('chana-black-raw', 'bengal gram', 'en'),
  ('idiyappam', 'string hopper', 'en'), ('idiyappam', 'nool puttu', 'ta'),
  ('upma', 'uppuma', 'en'), ('upma', 'uppittu', 'kn'),
  ('coconut-chutney', 'thengai chutney', 'ta'), ('coconut-chutney', 'nariyal chutney', 'hi'),
  ('oil-sunflower', 'ennai', 'ta'), ('oil-sunflower', 'tel', 'hi'), ('oil-sunflower', 'refined oil', 'en'),
  ('chicken-biryani', 'biriyani', 'en'), ('chicken-biryani', 'biryani', 'en'),
  ('tea-with-milk-sugar', 'chai', 'hi'), ('tea-with-milk-sugar', 'tea', 'en'),
  ('coffee-with-milk-sugar', 'filter kaapi', 'ta'), ('coffee-with-milk-sugar', 'degree coffee', 'en')
) as v(slug, alias, lang)
join public.foods f on f.slug = v.slug
on conflict (food_id, alias) do nothing;

-- ---------------------------------------------------------------------------
-- Substitutions: the "Can't eat this?" affordance.
-- ---------------------------------------------------------------------------
insert into public.ingredient_substitutions (food_id, substitute_id, ratio, reason, note)
select a.id, b.id, v.ratio, v.reason, v.note
from (values
  ('chicken-breast-raw', 'egg-whole-boiled', 1.6, 'unavailable',  'Roughly matches the protein. Three eggs for a 100 g chicken portion.'),
  ('chicken-breast-raw', 'soya-chunks',      0.5, 'vegetarian',   'Dry soya chunks are very protein dense - use about half the weight.'),
  ('chicken-breast-raw', 'paneer',           1.3, 'vegetarian',   'Higher in fat, so this adds calories as well as protein.'),
  ('chicken-breast-raw', 'toor-dal-raw',     1.0, 'cheaper',      'Cheaper, but lower in protein per rupee than eggs.'),
  ('paneer',             'soya-chunks',      0.4, 'cheaper',      'Considerably cheaper for the same protein.'),
  ('paneer',             'curd-plain',       2.0, 'cheaper',      'Cheaper, but much lower in protein by weight.'),
  ('paneer',             'egg-whole-boiled', 1.4, 'cheaper',      null),
  ('milk-toned',         'curd-plain',       1.0, 'preference',   null),
  ('rice-white-cooked',  'ragi-flour',       0.4, 'preference',   'More fibre, which helps with fullness.'),
  ('rice-white-cooked',  'brown-rice-cooked',1.0, 'higher_protein','Slightly more fibre and protein.'),
  ('chapati',            'idli',             1.0, 'preference',   'A lower-fat swap if the chapati is made with ghee.'),
  ('ghee',               'oil-sunflower',    1.0, 'cheaper',      null),
  ('paratha-plain',      'chapati',          1.0, 'preference',   'Roughly a third fewer calories for the same size.'),
  ('masala-dosa',        'dosa-plain',       1.0, 'preference',   'Plain dosa with sambar keeps the meal lighter.'),
  ('samosa',             'sundal',           1.5, 'preference',   'A savoury snack with far more protein and fibre.'),
  ('vada-medu',          'idli',             1.0, 'preference',   'Same meal, without the deep frying.'),
  ('cola',               'tea-with-milk-sugar', 1.0, 'preference', null)
) as v(from_slug, to_slug, ratio, reason, note)
join public.foods a on a.slug = v.from_slug
join public.foods b on b.slug = v.to_slug
on conflict (food_id, substitute_id, reason) do nothing;
