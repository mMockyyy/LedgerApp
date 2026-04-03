export const CATEGORIES = {
  "Food & Drinks": [
    "Restaurants",
    "Drinks",
    "Fast Food",
    "Groceries",
    "Bakery",
    "Other Food & Drinks"
  ] as const,
  "Transport": [
    "Public Transit",
    "Ride-Sharing",
    "Taxi",
    "Gas/Fuel",
    "Parking",
    "Car Maintenance",
    "Bike/Motorcycle"
  ] as const,
  "Health": [
    "Pharmacy",
    "Gym/Fitness",
    "Dental"
  ] as const,
  "Entertainment": [
    "Movies & Streaming",
    "Concerts & Events",
    "Gaming",
    "Books & Audio",
    "Sports",
    "Hobbies"
  ] as const,
  "Shopping & Personal": [
    "Clothing",
    "Shoes",
    "Cosmetics & Beauty",
    "Electronics",
    "Accessories"
  ] as const,
  "Utilities & Home": [
    "Electricity",
    "Water",
    "Internet",
    "Phone Bill",
    "Rent/Mortgage",
    "Home Repair",
    "Furniture"
  ] as const,
  "Education": [
    "Tuition",
    "Books & Materials",
    "Online Courses",
    "Supplies"
  ] as const,
  "Travel & Vacation": [
    "Flights",
    "Hotels",
    "Tours & Activities",
    "Travel Insurance"
  ] as const,
  "Subscriptions & Memberships": [
    "App Subscriptions",
    "Club Memberships",
    "Premium Services"
  ] as const,
  "Other": [
    "Gifts",
    "Donations",
    "Uncategorized"
  ] as const
} as const;

export const MAIN_CATEGORIES = [
  "Food & Drinks",
  "Transport",
  "Health",
  "Entertainment",
  "Shopping & Personal",
  "Utilities & Home",
  "Education",
  "Travel & Vacation",
  "Subscriptions & Memberships",
  "Other"
] as const;

export const ALL_SUBCATEGORIES = [
  "Restaurants",
  "Drinks",
  "Fast Food",
  "Groceries",
  "Bakery",
  "Other Food & Drinks",
  "Public Transit",
  "Ride-Sharing",
  "Taxi",
  "Gas/Fuel",
  "Parking",
  "Car Maintenance",
  "Bike/Motorcycle",
  "Pharmacy",
  "Gym/Fitness",
  "Dental",
  "Movies & Streaming",
  "Concerts & Events",
  "Gaming",
  "Books & Audio",
  "Sports",
  "Hobbies",
  "Clothing",
  "Shoes",
  "Cosmetics & Beauty",
  "Electronics",
  "Accessories",
  "Electricity",
  "Water",
  "Internet",
  "Phone Bill",
  "Rent/Mortgage",
  "Home Repair",
  "Furniture",
  "Tuition",
  "Books & Materials",
  "Online Courses",
  "Supplies",
  "Flights",
  "Hotels",
  "Tours & Activities",
  "Travel Insurance",
  "App Subscriptions",
  "Club Memberships",
  "Premium Services",
  "Gifts",
  "Donations",
  "Uncategorized"
] as const;

export function getSubcategoriesForCategory(category: string): string[] {
  return (CATEGORIES[category as keyof typeof CATEGORIES] || []) as unknown as string[];
}

export function getCategoryForSubcategory(subcategory: string): string | undefined {
  for (const [mainCat, subCats] of Object.entries(CATEGORIES)) {
    if ((subCats as any).includes(subcategory)) {
      return mainCat;
    }
  }
  return undefined;
}
