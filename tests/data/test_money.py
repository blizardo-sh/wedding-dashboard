import unittest
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
from extraction import money_matches, tariff_clause, rent_amount_needs_review

class MoneyExtraction(unittest.TestCase):
    def test_thousands_separators(self):
        for text in ['30.000 ₽','30,000 рублей','30 000 руб.','30\u202f000 р','30000₽']:
            with self.subTest(text=text):self.assertEqual([m[0] for m in money_matches(text)],[30000])
    def test_thousands_units_and_decimals(self):
        for text,value in [('2,5 тыс. руб.',2500),('2.5 тыс',2500),('15 тыс.',15000),('5т.р.',5000),('30к',30000),('1000,50 ₽',1000.5),('1.000,50 руб.',1000.5)]:
            with self.subTest(text=text):self.assertEqual([m[0] for m in money_matches(text)],[value])
    def test_range_and_multiple_amounts_stay_ambiguous(self):
        self.assertEqual([m[0] for m in money_matches('30.000–40.000 ₽')],[30000,40000])
        self.assertEqual([m[0] for m in money_matches('2,5-3 тыс. руб.')],[2500,3000])
        self.assertEqual([m[0] for m in money_matches('Дом 30 000 руб., уборка 5000 руб.')],[30000,5000])
    def test_unrelated_numbers_are_not_money(self):
        self.assertEqual(money_matches('Дом 600 м², 35 гостей, 20 мест; 21-22 февраля 2027'),[])
        self.assertEqual(money_matches('Телефон 8 915 555 55 55'),[])
        self.assertEqual(money_matches('29км, 3комнаты, 10 тысячелетий'),[])
    def test_zero_is_preserved_for_explicit_free_fees(self):
        self.assertEqual([m[0] for m in money_matches('Уборка 0 ₽')],[0])

class TariffClassification(unittest.TestCase):
    def test_extra_guests_are_never_base_rent(self):
        for text,threshold,unit in [
            ('СТОИМОСТЬ АРЕНДЫ: на 15 гостей сверх 3000р с гостя в сутки',15,'per_guest'),
            ('Цена указана до 10 челловек, каждый следующий 1 000 руб.',10,'per_stay'),
            ('Доплата за каждого гостя свыше 20 гостей 1500 руб.',20,'per_guest'),
            ('Стоимость аренды: до 10 гостей свыше 1700р в сутки',10,'per_stay'),
            ('Цена указана до 20 гостей далее 1.000₽ с гостя',20,'per_guest'),
            ('Стоимость указана за 6 человек, каждый последующий 1000₽.',None,'per_stay'),
            ('Будни 30, пятница, суббота 50, за 20 гостей, доп гости 1000₽',None,'per_stay'),
            ('Цена до 20 человек, каждый доп.гость - 2000р.',20,'per_stay'),
            ('Стоимость (за 16 человек, дневные гости +1 000 ₽):',None,'per_stay'),
        ]:
            with self.subTest(text=text):
                rule=tariff_clause(text)
                self.assertEqual(rule['kind'],'extra_guests')
                self.assertEqual(rule['included_guests'],threshold)
                self.assertEqual(rule['unit'],unit)
                self.assertEqual(rule['guest_scope'],'day_only_guests' if 'дневные гости' in text else 'unknown')
    def test_services_keep_their_own_per_person_rate(self):
        rule=tariff_clause('Баня 2000 руб. с гостя')
        self.assertEqual((rule['kind'],rule['service_id'],rule['unit']),('service','banya','per_guest'))
    def test_normal_rent_and_session_units(self):
        self.assertEqual(tariff_clause('Воскресенье 35 000 руб. до 20 гостей')['kind'],'rent_base')
        self.assertEqual(tariff_clause('Сауна 5000 руб. за 2 часа')['session_hours'],2)
        self.assertEqual(tariff_clause('Полные выходные 180 000 руб.')['unit'],'package')
    def test_services_and_hourly_prices_are_not_nightly_rent(self):
        for text,kind in [
            ('Стоимость парения 7.500₽ время НЕ ОГРАНИЧЕНО!', 'service'),
            ('джакузи в будний день 3 000 р./заезд','service'),
            ('В выходные за Wi-fi — от 1000 р.','unresolved'),
            ('Стоимость мытья посуды от 2000₽.','unresolved'),
            ('Стоимость заселения с маленькой собакой, доплата - 5000р','service'),
        ]:
            with self.subTest(text=text):self.assertEqual(tariff_clause(text)['kind'],kind)
        self.assertEqual(tariff_clause('Сб -5000р/ч мин три часа')['unit'],'per_hour')
        self.assertEqual(tariff_clause('7500 руб 3 часа до 6 человек')['unit'],'per_session')
        self.assertEqual(tariff_clause('6т.р. за весь день в пятницу и воскресенье')['unit'],'per_day')
    def test_tiny_source_rent_requires_review_without_rescaling(self):
        self.assertEqual(money_matches('Воскресенье-понедельник 35₽')[0][0],35)
        self.assertTrue(rent_amount_needs_review('rent_base',35))
        self.assertTrue(rent_amount_needs_review('rent_base',0))
        self.assertFalse(rent_amount_needs_review('rent_base',35000))
        self.assertFalse(rent_amount_needs_review('mandatory_fee',500))
if __name__=='__main__':unittest.main()
