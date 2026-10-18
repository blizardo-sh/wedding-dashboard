import unittest
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
from extraction import money_matches

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
if __name__=='__main__':unittest.main()
