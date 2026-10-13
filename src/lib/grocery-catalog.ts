/**
 * Built-in common-grocery catalog for autocomplete.
 * Used as the fallback suggestion source when the pilot has no purchase
 * history yet (or as a supplement below their own past items).
 */
export const GROCERY_CATALOG: string[] = [
  // Produce
  "Milk", "Eggs", "Bread", "Butter", "Cheese", "Yogurt", "Cream cheese",
  "Bananas", "Apples", "Oranges", "Grapes", "Strawberries", "Blueberries",
  "Lemons", "Limes", "Avocados", "Tomatoes", "Lettuce", "Spinach", "Kale",
  "Carrots", "Celery", "Onions", "Garlic", "Potatoes", "Sweet potatoes",
  "Broccoli", "Cauliflower", "Bell peppers", "Cucumbers", "Zucchini",
  "Mushrooms", "Green beans", "Corn", "Peas", "Asparagus", "Cabbage",
  "Fresh herbs", "Ginger", "Pineapple", "Watermelon", "Peaches", "Pears",
  "Plums", "Cherries", "Raspberries", "Blackberries", "Mango", "Kiwi",
  // Meat & seafood
  "Chicken breast", "Ground beef", "Ground turkey", "Bacon", "Sausage",
  "Ham", "Turkey slices", "Salmon", "Tuna", "Shrimp", "Tilapia", "Pork chops",
  "Steak", "Hot dogs", "Pepperoni", "Deli turkey",
  // Dairy & refrigerated
  "Sour cream", "Whipped cream", "Half and half", "Cottage cheese",
  "Mozzarella", "Cheddar", "Parmesan", "Swiss cheese", "Orange juice",
  "Apple juice", "Hummus", "Salsa", "Guacamole", "Tortillas", "Pita bread",
  "Bagels", "English muffins", "Croissants", "Donuts",
  // Pantry
  "Rice", "Pasta", "Spaghetti", "Mac and cheese", "Flour", "Sugar",
  "Brown sugar", "Baking powder", "Baking soda", "Salt", "Black pepper",
  "Olive oil", "Vegetable oil", "Vinegar", "Soy sauce", "Ketchup", "Mustard",
  "Mayo", "BBQ sauce", "Hot sauce", "Peanut butter", "Jelly", "Honey",
  "Maple syrup", "Pancake mix", "Oatmeal", "Cereal", "Granola bars",
  "Crackers", "Chips", "Pretzels", "Popcorn", "Nuts", "Trail mix",
  "Canned tomatoes", "Canned beans", "Canned tuna", "Canned soup",
  "Chicken broth", "Beef broth", "Tomato sauce", "Pasta sauce",
  "Taco shells", "Taco seasoning", "Salsa", "Refried beans",
  "Coffee", "Tea", "Hot chocolate", "Protein powder",
  // Frozen
  "Frozen pizza", "Frozen berries", "Frozen vegetables", "Ice cream",
  "Frozen waffles", "Frozen burritos", "Frozen shrimp", "French fries",
  "Frozen chicken nuggets", "Popsicles",
  // Bakery
  "Sandwich bread", "Whole wheat bread", "Baguette", "Dinner rolls",
  "Hamburger buns", "Tortilla chips",
  // Beverages
  "Water bottles", "Sparkling water", "Soda", "Lemonade", "Iced tea",
  "Sports drinks", "Energy drinks", "Milkshakes",
  // Snacks
  "Cookies", "Brownies", "Candy", "Chocolate", "Gummy bears", "Fruit snacks",
  "Rice cakes", "Beef jerky", "Cheese sticks", "Applesauce",
  // Household
  "Paper towels", "Toilet paper", "Tissues", "Napkins", "Trash bags",
  "Dish soap", "Dishwasher pods", "Laundry detergent", "Dryer sheets",
  "Bleach", "All-purpose cleaner", "Glass cleaner", "Sponges",
  "Paper plates", "Plastic cups", "Aluminum foil", "Plastic wrap",
  "Ziploc bags", "Batteries", "Light bulbs",
  // Personal care / pharmacy
  "Shampoo", "Conditioner", "Body wash", "Soap", "Toothpaste",
  "Toothbrush", "Deodorant", "Lotion", "Sunscreen", "Lip balm",
  "Bandages", "Pain reliever", "Cold medicine", "Allergy medicine",
  "Vitamins", "Hand sanitizer", "Cotton balls", "Q-tips",
  // Baby & pets
  "Diapers", "Baby wipes", "Baby food", "Dog food", "Cat food",
  "Cat litter", "Dog treats",
];

/** Case-insensitive substring match against the catalog, capped at `limit`. */
export function matchCatalog(query: string, limit = 8): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: string[] = [];
  for (const item of GROCERY_CATALOG) {
    if (item.toLowerCase().includes(q)) {
      out.push(item);
      if (out.length >= limit) break;
    }
  }
  return out;
}
