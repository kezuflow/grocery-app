ALTER TABLE category ADD COLUMN icon_asset_key TEXT
  CHECK (
    icon_asset_key IS NULL OR (
      icon_asset_key NOT LIKE '%/%' AND
      icon_asset_key NOT LIKE '%\%' AND
      icon_asset_key NOT LIKE '%..%' AND
      icon_asset_key LIKE '%.svg'
    )
  );

UPDATE category SET icon_asset_key = 'fruits.svg' WHERE code = 'FRUITS';
UPDATE category SET icon_asset_key = 'vegetables.svg' WHERE code = 'VEGETABLES';
UPDATE category SET icon_asset_key = 'leafy-greens-herbs.svg' WHERE code = 'LEAFY_GREENS_HERBS';
UPDATE category SET icon_asset_key = 'roots-tubers-bulbs.svg' WHERE code = 'ROOTS_TUBERS_BULBS';
UPDATE category SET icon_asset_key = 'beans-peas-seeds.svg' WHERE code = 'BEANS_PEAS_SEEDS';
UPDATE category SET icon_asset_key = 'aromatics-spices.svg' WHERE code = 'AROMATICS_SPICES';
UPDATE category SET icon_asset_key = 'native-specialty-produce.svg' WHERE code = 'NATIVE_SPECIALTY_PRODUCE';
