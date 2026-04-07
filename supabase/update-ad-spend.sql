-- Update daily_pnl with real Meta + Google ad spend for Tallow Twins
-- Meta account: act_736883766717486 (CAD)
-- Google account: 6996956911 (CAD)

DO $$
DECLARE
  v_brand_id uuid;
BEGIN
  SELECT id INTO v_brand_id FROM brands WHERE name ILIKE '%tallow%' LIMIT 1;

  UPDATE daily_pnl SET meta_spend = 976.47, google_spend = 349.23, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-03';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-03', 976.47, 349.23);
  END IF;

  UPDATE daily_pnl SET meta_spend = 985.74, google_spend = 238.05, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-04';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-04', 985.74, 238.05);
  END IF;

  UPDATE daily_pnl SET meta_spend = 1062.66, google_spend = 319.97, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-05';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-05', 1062.66, 319.97);
  END IF;

  UPDATE daily_pnl SET meta_spend = 1001.95, google_spend = 305.81, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-06';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-06', 1001.95, 305.81);
  END IF;

  UPDATE daily_pnl SET meta_spend = 922.88, google_spend = 378.62, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-07';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-07', 922.88, 378.62);
  END IF;

  UPDATE daily_pnl SET meta_spend = 1017.78, google_spend = 374.41, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-08';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-08', 1017.78, 374.41);
  END IF;

  UPDATE daily_pnl SET meta_spend = 992.45, google_spend = 291.27, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-09';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-09', 992.45, 291.27);
  END IF;

  UPDATE daily_pnl SET meta_spend = 687.97, google_spend = 262.31, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-10';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-10', 687.97, 262.31);
  END IF;

  UPDATE daily_pnl SET meta_spend = 374.54, google_spend = 175.86, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-11';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-11', 374.54, 175.86);
  END IF;

  UPDATE daily_pnl SET meta_spend = 417.85, google_spend = 191.3, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-12';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-12', 417.85, 191.3);
  END IF;

  UPDATE daily_pnl SET meta_spend = 375.06, google_spend = 169.95, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-13';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-13', 375.06, 169.95);
  END IF;

  UPDATE daily_pnl SET meta_spend = 350.18, google_spend = 223.89, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-14';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-14', 350.18, 223.89);
  END IF;

  UPDATE daily_pnl SET meta_spend = 408.47, google_spend = 200.36, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-15';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-15', 408.47, 200.36);
  END IF;

  UPDATE daily_pnl SET meta_spend = 379.18, google_spend = 199.56, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-16';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-16', 379.18, 199.56);
  END IF;

  UPDATE daily_pnl SET meta_spend = 383.5, google_spend = 186.15, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-17';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-17', 383.5, 186.15);
  END IF;

  UPDATE daily_pnl SET meta_spend = 403.49, google_spend = 187.14, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-18';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-18', 403.49, 187.14);
  END IF;

  UPDATE daily_pnl SET meta_spend = 403.21, google_spend = 172.62, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-19';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-19', 403.21, 172.62);
  END IF;

  UPDATE daily_pnl SET meta_spend = 647.41, google_spend = 174.16, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-20';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-20', 647.41, 174.16);
  END IF;

  UPDATE daily_pnl SET meta_spend = 1067.69, google_spend = 171.95, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-21';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-21', 1067.69, 171.95);
  END IF;

  UPDATE daily_pnl SET meta_spend = 1190.29, google_spend = 172.04, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-22';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-22', 1190.29, 172.04);
  END IF;

  UPDATE daily_pnl SET meta_spend = 993.28, google_spend = 217.64, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-23';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-23', 993.28, 217.64);
  END IF;

  UPDATE daily_pnl SET meta_spend = 1146.24, google_spend = 179.92, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-24';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-24', 1146.24, 179.92);
  END IF;

  UPDATE daily_pnl SET meta_spend = 1233.18, google_spend = 186.18, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-25';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-25', 1233.18, 186.18);
  END IF;

  UPDATE daily_pnl SET meta_spend = 1068.69, google_spend = 173.31, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-26';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-26', 1068.69, 173.31);
  END IF;

  UPDATE daily_pnl SET meta_spend = 1068.57, google_spend = 161.01, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-27';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-27', 1068.57, 161.01);
  END IF;

  UPDATE daily_pnl SET meta_spend = 997.69, google_spend = 150.55, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-02-28';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-02-28', 997.69, 150.55);
  END IF;

  UPDATE daily_pnl SET meta_spend = 1178.88, google_spend = 175.03, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-01';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-01', 1178.88, 175.03);
  END IF;

  UPDATE daily_pnl SET meta_spend = 1417.51, google_spend = 198.17, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-02';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-02', 1417.51, 198.17);
  END IF;

  UPDATE daily_pnl SET meta_spend = 2011.46, google_spend = 195.18, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-03';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-03', 2011.46, 195.18);
  END IF;

  UPDATE daily_pnl SET meta_spend = 1522.8, google_spend = 180.98, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-04';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-04', 1522.8, 180.98);
  END IF;

  UPDATE daily_pnl SET meta_spend = 1495.84, google_spend = 176.3, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-05';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-05', 1495.84, 176.3);
  END IF;

  UPDATE daily_pnl SET meta_spend = 832.82, google_spend = 172.22, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-06';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-06', 832.82, 172.22);
  END IF;

  UPDATE daily_pnl SET meta_spend = 821.19, google_spend = 164.29, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-07';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-07', 821.19, 164.29);
  END IF;

  UPDATE daily_pnl SET meta_spend = 948.72, google_spend = 169.52, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-08';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-08', 948.72, 169.52);
  END IF;

  UPDATE daily_pnl SET meta_spend = 931.99, google_spend = 200.26, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-09';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-09', 931.99, 200.26);
  END IF;

  UPDATE daily_pnl SET meta_spend = 917.21, google_spend = 179.31, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-10';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-10', 917.21, 179.31);
  END IF;

  UPDATE daily_pnl SET meta_spend = 865.61, google_spend = 224.27, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-11';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-11', 865.61, 224.27);
  END IF;

  UPDATE daily_pnl SET meta_spend = 856.38, google_spend = 207.46, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-12';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-12', 856.38, 207.46);
  END IF;

  UPDATE daily_pnl SET meta_spend = 859.39, google_spend = 149.29, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-13';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-13', 859.39, 149.29);
  END IF;

  UPDATE daily_pnl SET meta_spend = 914.71, google_spend = 164.48, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-14';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-14', 914.71, 164.48);
  END IF;

  UPDATE daily_pnl SET meta_spend = 938.06, google_spend = 162.72, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-15';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-15', 938.06, 162.72);
  END IF;

  UPDATE daily_pnl SET meta_spend = 916.4, google_spend = 212.66, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-16';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-16', 916.4, 212.66);
  END IF;

  UPDATE daily_pnl SET meta_spend = 877.24, google_spend = 183.79, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-17';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-17', 877.24, 183.79);
  END IF;

  UPDATE daily_pnl SET meta_spend = 887.25, google_spend = 171.77, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-18';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-18', 887.25, 171.77);
  END IF;

  UPDATE daily_pnl SET meta_spend = 894.43, google_spend = 131.96, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-19';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-19', 894.43, 131.96);
  END IF;

  UPDATE daily_pnl SET meta_spend = 869.06, google_spend = 198.78, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-20';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-20', 869.06, 198.78);
  END IF;

  UPDATE daily_pnl SET meta_spend = 915.82, google_spend = 303.49, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-21';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-21', 915.82, 303.49);
  END IF;

  UPDATE daily_pnl SET meta_spend = 971.21, google_spend = 281.11, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-22';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-22', 971.21, 281.11);
  END IF;

  UPDATE daily_pnl SET meta_spend = 907.17, google_spend = 269.44, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-23';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-23', 907.17, 269.44);
  END IF;

  UPDATE daily_pnl SET meta_spend = 925.87, google_spend = 296.31, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-24';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-24', 925.87, 296.31);
  END IF;

  UPDATE daily_pnl SET meta_spend = 890.7, google_spend = 303.4, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-25';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-25', 890.7, 303.4);
  END IF;

  UPDATE daily_pnl SET meta_spend = 846.06, google_spend = 302.32, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-26';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-26', 846.06, 302.32);
  END IF;

  UPDATE daily_pnl SET meta_spend = 877.02, google_spend = 317.44, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-27';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-27', 877.02, 317.44);
  END IF;

  UPDATE daily_pnl SET meta_spend = 877.79, google_spend = 288.89, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-28';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-28', 877.79, 288.89);
  END IF;

  UPDATE daily_pnl SET meta_spend = 943.95, google_spend = 247.5, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-29';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-29', 943.95, 247.5);
  END IF;

  UPDATE daily_pnl SET meta_spend = 797.15, google_spend = 225.1, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-30';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-30', 797.15, 225.1);
  END IF;

  UPDATE daily_pnl SET meta_spend = 851.57, google_spend = 217.18, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-03-31';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-03-31', 851.57, 217.18);
  END IF;

  UPDATE daily_pnl SET meta_spend = 993.06, google_spend = 301.5, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-04-01';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-04-01', 993.06, 301.5);
  END IF;

  UPDATE daily_pnl SET meta_spend = 1146.72, google_spend = 275.55, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-04-02';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-04-02', 1146.72, 275.55);
  END IF;

  UPDATE daily_pnl SET meta_spend = 1460.75, google_spend = 292.68, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-04-03';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-04-03', 1460.75, 292.68);
  END IF;

  UPDATE daily_pnl SET meta_spend = 1092.1, google_spend = 294.88, synced_at = now()
    WHERE brand_id = v_brand_id AND date = '2026-04-04';
  IF NOT FOUND THEN
    INSERT INTO daily_pnl (brand_id, date, meta_spend, google_spend)
    VALUES (v_brand_id, '2026-04-04', 1092.1, 294.88);
  END IF;

END $$;