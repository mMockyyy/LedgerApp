import { env } from "../config/env";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ParsedReceipt {
  extractedText: string;
  amount?: number;
  merchant?: string;
  category?: string;
  subcategory?: string;
  incurredAt?: string;
  parserSource?: "rules" | "llm" | "hybrid-llm" | "hybrid-rules" | "llm-fallback-rules" | "tabscanner";
  parserConfidence?: number;
  llmAttempted?: boolean;
  llmSucceeded?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers shared with budget AI
// ---------------------------------------------------------------------------

function resolveAppReferer(): string {
  return env.APP_URL || env.RENDER_EXTERNAL_URL || "http://localhost:3000";
}

function extractFirstJsonObject(payload: string) {
  const firstBrace = payload.indexOf("{");
  const lastBrace = payload.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  return payload.slice(firstBrace, lastBrace + 1);
}

function getLlmApiKeys() {
  const configuredList = (env.LLM_API_KEYS || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

  const combined = [env.LLM_API_KEY, env.OPENAI_API_KEY, ...configuredList]
    .filter((key): key is string => Boolean(key && key.trim()))
    .map((key) => key.trim());

  return Array.from(new Set(combined));
}

function shouldRetryWithNextKey(statusCode: number) {
  return statusCode === 401 || statusCode === 402 || statusCode === 403 || statusCode === 429 || statusCode >= 500;
}

// ---------------------------------------------------------------------------
// Category inference (rules-based, used as fallback when TabScanner doesn't
// return enough context to categorize)
// ---------------------------------------------------------------------------

function normalizeCategory(value?: string): { category?: string; subcategory?: string } {
  if (!value) return {};
  const n = value.toLowerCase().trim();

  // ── Groceries / Convenience stores ──────────────────────────────────────
  if (/\b(alfamart|indomaret|ministop|7[-\s]?eleven|711|family\s?mart|lawson|circle\s?k|ok[_\s]?mart|allday|all\s?day\s?supermarket|puregold|savemore|save\s?more|s&r|sm\s?supermarket|sm\s?hypermarket|robinsons\s?supermarket|landmark\s?supermarket|shopwise|hypermart|ever\s?gotesco|unimart|waltermart|walter\s?mart|pioneer\s?center|landers|costco|rustan['']?s\s*(supermarket|fresh)?|well[- ]?come|express\s?save|cssi|csi|bigshot|bigshot\s*mart|winwin|prince\s*hypermart|warehouse\s*club|merkado|palengke|wet\s*market|grocery|groceries|supermarket|hypermarket)\b/.test(n)) {
    return { category: "Food & Drinks", subcategory: "Groceries" };
  }

  // ── Fast food chains ─────────────────────────────────────────────────────
  if (/\b(jollibee|mcdonald['']?s?|mcdo|burger\s?king|kfc|chowking|wendy['']?s?|popeye['']?s?|pizza\s?hut|greenwich|shakey['']?s?|mang\s?inasal|bonchon|army\s?navy|brother['']?s\s*burger|8\s*cuts|angel['']?s\s*burger|zark['']?s\s*burger|tropical\s*hut|max['']?s?\s*(restaurant|fried\s*chicken)?|amber|aristocrat|cabalen|kamayan|vikings|yakimix|gerry['']?s\s*grill|banana\s*leaf|mesa|sentro|spiral|sambokojin|sambo\s*kojin|taco\s*bell|subway|quiznos|tim\s*hortons|carl['']?s\s*jr|five\s*guys|in\s*[-&]\s*out|shake\s*shack|habit\s*burger|quick\s*service|fast\s*food|fastfood|drive[- ]?thru|drive[- ]?through)\b/.test(n)) {
    return { category: "Food & Drinks", subcategory: "Fast Food" };
  }

  // ── Bakeries ─────────────────────────────────────────────────────────────
  if (/\b(bakery|bakeshop|pandesal|bread|pastry|cake\s*shop|goldilocks|red\s*ribbon|tous\s*les\s*jours|paris\s*baguette|breadtalk|delifrance|o['']?brien['']?s|pan\s*de\s*manila|french\s*baker|yellow\s*cab\s*pizza|conti['']?s|sugar[\s&]+spice)\b/.test(n)) {
    return { category: "Food & Drinks", subcategory: "Bakery" };
  }

  // ── Drinks / Cafes / Coffee ───────────────────────────────────────────────
  if (/\b(starbucks|coffee\s*bean|dunkin['']?(\s*donuts)?|bo['']?s\s*coffee|figaro|tim\s*hortons|seattle['']?s\s*best|cbtl|peet['']?s|toby['']?s\s*estate|single\s*origin|cafe|coffee|kape|milk\s*tea|boba|chatime|happy\s*lemon|infinitea|gong\s*cha|tiger\s*sugar|macao\s*imperial|cha\s*tuk\s*chak|serenitea|dakasi|coco\s*fresh|initially\s*coffee|smoothie|juice\s*bar|fruit\s*shake|cold\s*brew|tea\s*shop|beverage|drinks?\s*stall)\b/.test(n)) {
    return { category: "Food & Drinks", subcategory: "Drinks" };
  }

  // ── Restaurants / Dining ─────────────────────────────────────────────────
  if (/\b(restaurant|diner|eatery|dining|carinderia|lutong\s*bahay|ulam|turo[- ]?turo|food\s*court|foodcourt|food\s*stall|carenderia|ihaw[- ]?ihaw|grill|bbq|chop\s*house|chophouse|steakhouse|steak\s*house|chinese\s*restaurant|japanese\s*restaurant|korean\s*bbq|samgyupsal|samgyup|buffet|all[- ]?you[- ]?can[- ]?eat|sizzling|ihaw|seafood|sushi|ramen|pho|thai\s*restaurant|indian\s*restaurant|italian\s*restaurant|pizza(?!\s*hut)|pasta\s*restaurant|tapas|bistro|brasserie|gastropub|pub\s*grub|food\s*hub|food\s*park)\b/.test(n)) {
    return { category: "Food & Drinks", subcategory: "Restaurants" };
  }

  // ── General food keywords (catch-all) ────────────────────────────────────
  if (/\b(food|meal|rice|viand|snack|lutong|ulam|kain|almusal|tanghalian|hapunan|merienda|lutong|pagkain)\b/.test(n)) {
    return { category: "Food & Drinks", subcategory: "Other Food & Drinks" };
  }

  // ── Ride-sharing ─────────────────────────────────────────────────────────
  if (/\b(grab\s*(car|express|taxi|bike|food)?|uber|joyride|angkas|move[_ ]?it|owto|hirna|rideshare|ride[- ]?hailing)\b/.test(n)) {
    return { category: "Transport", subcategory: "Ride-Sharing" };
  }

  // ── Taxi ─────────────────────────────────────────────────────────────────
  if (/\btaxi\b/.test(n)) {
    return { category: "Transport", subcategory: "Taxi" };
  }

  // ── Gas / Fuel ───────────────────────────────────────────────────────────
  if (/\b(petron|shell|caltex|phoenix\s*(petroleum|gas)?|total\s*(energies)?|seaoil|flying\s*v|cleanfuel|gas\s*station|gasoline|fuel|petrol|diesel|unleaded|premium\s*gasoline|e10|ron\s*9[15])\b/.test(n)) {
    return { category: "Transport", subcategory: "Gas/Fuel" };
  }

  // ── Parking ───────────────────────────────────────────────────────────────
  if (/\b(parking|park\s*&\s*ride|car\s*park|ayala\s*parking|sm\s*parking|robinsons\s*parking|valet)\b/.test(n)) {
    return { category: "Transport", subcategory: "Parking" };
  }

  // ── Car maintenance ────────────────────────────────────────────────────────
  if (/\b(mechanic|auto\s*shop|car\s*repair|oil\s*change|car\s*maintenance|vulcanizing|vulcanization|llantera|wheel\s*alignment|car\s*wash|auto\s*detailing|lube\s*service|transmission|radiator|brake\s*service|casa|dealership|casa\s*service)\b/.test(n)) {
    return { category: "Transport", subcategory: "Car Maintenance" };
  }

  // ── Bike / Motorcycle ──────────────────────────────────────────────────────
  if (/\b(motorcycle|motorbike|motor\s*shop|moto\s*service|bike\s*shop|cycling|bicycle|e[- ]?bike)\b/.test(n)) {
    return { category: "Transport", subcategory: "Bike/Motorcycle" };
  }

  // ── Public transit ────────────────────────────────────────────────────────
  if (/\b(mrt|lrt|brt|pnr|metro\s*rail|beep\s*card|ez[-\s]?link|rapid\s*pass|bus\s*(terminal|fare|ticket)?|jeepney|jeep|tricycle|kuliglig|pedicab|habal[- ]?habal|public\s*transit|transit\s*fare|train\s*(fare|ticket)?|toll|nlex|slex|skyway|cavitex|star\s*toll|tplex|easytrip)\b/.test(n)) {
    return { category: "Transport", subcategory: "Public Transit" };
  }

  // ── Philippine bus operators ───────────────────────────────────────────────
  // These print branded tickets (DEL MONTE, SPS, SANTRANS, etc.) with FARETYPE field
  if (/\b(del\s*monte|santrans|sps|rts|jac\s*liner|victory\s*liner|genesis|five\s*star|first\s*north\s*luzon|bltb|partas|farinas|dagupan\s*bus|nueva\s*ecija|baliwag|saulog|batangas\s*laguna|phl\s*transit|solid\s*north|solid\s*luzon|faretype|amount\s*due)\b/.test(n)) {
    return { category: "Transport", subcategory: "Public Transit" };
  }

  // ── General transport ─────────────────────────────────────────────────────
  if (/\b(transport|travel\s*fare|commute|fare|ticket\s*(fare)?)\b/.test(n)) {
    return { category: "Transport", subcategory: "Public Transit" };
  }

  // ── Pharmacy / Medicine ───────────────────────────────────────────────────
  if (/\b(mercury[\s-]?drug|watsons?|rose[\s-]?pharmacy|southstar[\s-]?drug|generika|medexpress|med\s*express|drugstore|pharmacy|botica|biogesic|decolgen|neozep|diatabs|bactidol|kremil[\s-]?s|loperamide|ascorbic|paracetamol|ibuprofen|mefenamic|amoxicillin|antibiotic|vitamin[s]?|supplement|multivitamin|medicine|medicament|rx\s*drugs?|prescription|otc|over[- ]?the[- ]?counter)\b/.test(n)) {
    return { category: "Health", subcategory: "Pharmacy" };
  }

  // ── Gym / Fitness ─────────────────────────────────────────────────────────
  if (/\b(anytime\s*fitness|fitness\s*first|gold['']?s\s*gym|UFC\s*gym|crossfit|snap\s*fitness|f45|cult\s*fitness|gym|fitness\s*center|workout|yoga\s*studio|pilates|zumba|spin\s*class|boxing\s*gym|muay\s*thai)\b/.test(n)) {
    return { category: "Health", subcategory: "Gym/Fitness" };
  }

  // ── Dental ────────────────────────────────────────────────────────────────
  if (/\b(dental|dentist|orthodontic|braces|tooth|teeth|oral\s*care|oral\s*b|smile\s*dental|dental\s*clinic)\b/.test(n)) {
    return { category: "Health", subcategory: "Dental" };
  }

  // ── General health / medical ──────────────────────────────────────────────
  if (/\b(hospital|clinic|health\s*center|medical\s*center|doctor|physician|checkup|check[- ]?up|laboratory|lab\s*test|x[- ]?ray|ultrasound|mri|ct\s*scan|consultation\s*fee|health\s*card|hmo|philhealth|medicard|maxicare|intellicare|caritas|st\s*luke['']?s|makati\s*med|the\s*medical\s*city|asian\s*hospital|chinese\s*general)\b/.test(n)) {
    return { category: "Health", subcategory: "Pharmacy" };
  }

  // ── Movies & Streaming ────────────────────────────────────────────────────
  if (/\b(netflix|disney\s*(\+|plus)|hbo\s*(go|max)?|amazon\s*prime\s*video|apple\s*tv\s*\+?|viu|mubi|criterion|youtube\s*premium|iflix|hooq|cinema|movie\s*house|sm\s*cinema|ayala\s*cinemas?|robinsons\s*movieworld|gateway\s*cineplex|trinoma\s*cinemas?|greenbelt\s*cinemas?|bgc\s*cinemas?|film|theatre|theater)\b/.test(n)) {
    return { category: "Entertainment", subcategory: "Movies & Streaming" };
  }

  // ── Gaming ───────────────────────────────────────────────────────────────
  if (/\b(steam|epic\s*games|playstation\s*store|ps\s*store|xbox\s*live|nintendo\s*eshop|mobile\s*legends|ml\s*diamonds?|codm|garena|riot\s*games|roblox|gaming|game\s*(credits?|load|shop)|esports|internet\s*cafe|icafe)\b/.test(n)) {
    return { category: "Entertainment", subcategory: "Gaming" };
  }

  // ── Concerts & Events ─────────────────────────────────────────────────────
  if (/\b(concert|live\s*show|gig|festival|sm\s*tickets?|ticketnet|ticketmaster|araneta|smart\s*araneta|moa\s*arena|smc\s*arena|sm\s*mall\s*of\s*asia\s*arena|event\s*ticket|event\s*pass|admission\s*fee|entrance\s*fee|event\s*venue)\b/.test(n)) {
    return { category: "Entertainment", subcategory: "Concerts & Events" };
  }

  // ── Books & Audio ────────────────────────────────────────────────────────
  if (/\b(national\s*bookstore|nbs|fully\s*booked|powerbooks|spotify|apple\s*music|amazon\s*music|youtube\s*music|audible|scribd|kindle|bookshop|book\s*store|ebook|audiobook|podcast)\b/.test(n)) {
    return { category: "Entertainment", subcategory: "Books & Audio" };
  }

  // ── Sports ───────────────────────────────────────────────────────────────
  if (/\b(sports\s*center|sports\s*complex|badminton\s*court|tennis\s*court|swimming\s*pool|bowling|billiards|golf|golf\s*course|country\s*club|sports\s*equipment|running\s*event|marathon|triathlon|sports\s*registration)\b/.test(n)) {
    return { category: "Entertainment", subcategory: "Sports" };
  }

  // ── Hobbies ──────────────────────────────────────────────────────────────
  if (/\b(art\s*supply|craft\s*store|hobby\s*shop|lego|gunpla|scale\s*model|board\s*game|card\s*game|mtg|pokemon\s*cards?|photography\s*gear|camera\s*shop|musical\s*instrument|guitar\s*center|sheet\s*music|knitting|sewing\s*supplies?)\b/.test(n)) {
    return { category: "Entertainment", subcategory: "Hobbies" };
  }

  // ── Shoes ────────────────────────────────────────────────────────────────
  if (/\b(nike|adidas|new\s*balance|puma|converse|vans|reebok|skechers|fila|asics|brooks|hoka|under\s*armour|timberland|dr\s*martens|birkenstock|crocs|havaianas|payless|shoe\s*mart|shoe\s*salon|sm\s*shoes|parisian|footwear\s*store|shoe\s*store|shoes?|sneakers?|boots?|heels?|sandals?|slippers?|loafers?|flats?)\b/.test(n)) {
    // Only categorize as shoes if it looks like a shoe purchase, not just the item in a grocery list
    if (/\b(nike|adidas|new\s*balance|puma|converse|vans|reebok|skechers|fila|asics|brooks|hoka|under\s*armour|timberland|dr\s*martens|birkenstock|crocs|havaianas|payless|shoe\s*mart|shoe\s*salon|sm\s*shoes|parisian|footwear\s*store|shoe\s*store)\b/.test(n)) {
      return { category: "Shopping & Personal", subcategory: "Shoes" };
    }
  }

  // ── Clothing ─────────────────────────────────────────────────────────────
  if (/\b(h&m|h\s*and\s*m|zara|uniqlo|gap|forever\s*21|bench|penshoppe|folded\s*&?\s*hung|human|bershka|pull\s*&?\s*bear|mango|charles\s*&?\s*keith|cotton\s*on|marks\s*&?\s*spencer|topshop|department\s*store|divisoria|ukay[- ]?ukay|ref\s*shop|surplus\s*shop|clothing|clothes|apparel|garment|fashion|textile|fabric|shirt|pants|jacket|blouse|shorts|skirt|uniform|dress|blazer|coat|polo|tshirt|t[-\s]?shirt)\b/.test(n)) {
    return { category: "Shopping & Personal", subcategory: "Clothing" };
  }

  // ── Cosmetics & Beauty ───────────────────────────────────────────────────
  if (/\b(sephora|mac\s*cosmetics|nyx|maybelline|l['']?oreal|loreal|revlon|cetaphil|neutrogena|the\s*ordinary|skii|sk[- ]?ii|innisfree|laneige|etude\s*house|nature\s*republic|bath\s*&?\s*body\s*works|body\s*shop|kiehl['']?s|clinique|benefit|urban\s*decay|too\s*faced|sm\s*beauty|beauty\s*bar|rustan['']?s\s*the\s*beauty\s*source|cosmetics?|beauty\s*(store|shop|salon|bar)?|makeup|lipstick|foundation|skincare|face\s*wash|moisturizer|sunscreen|serum|toner|shampoo|conditioner|lotion|perfume|cologne|deodorant|salon|spa|nail\s*(salon|spa|studio)|blowout|hair\s*(cut|color|treatment|salon)|barbershop|barber)\b/.test(n)) {
    return { category: "Shopping & Personal", subcategory: "Cosmetics & Beauty" };
  }

  // ── Electronics ──────────────────────────────────────────────────────────
  if (/\b(apple\s*store|istore|power\s*mac\s*center|beyond\s*the\s*box|villman|asianic|abenson|anson['']?s|datablitz|pc\s*express|asiapac|pcworx|pc\s*options|electronic\s*city|samsung\s*(store|experience)|huawei\s*store|xiaomi\s*store|iphone|ipad|macbook|airpods|samsung\s*galaxy|pixel|laptop|computer|desktop|tablet|charger|cable|headphones?|earbuds?|earphones?|speaker|gadget|smart\s*device|powerbank|power\s*bank|router|wifi\s*extender|smart\s*tv|monitor|keyboard|mouse|electronics)\b/.test(n)) {
    return { category: "Shopping & Personal", subcategory: "Electronics" };
  }

  // ── Accessories ──────────────────────────────────────────────────────────
  if (/\b(bag|purse|wallet|belt|watch|jewelry|jewellery|necklace|bracelet|ring|earring|keychain|scarf|hat|cap|beanie|sunglasses|eyeglasses?|optical|spectacles?|frames?|rolex|seiko|citizen|casio|fossil|swatch|michael\s*kors|coach|gucci\s*accessory|louis\s*vuitton|kate\s*spade)\b/.test(n)) {
    return { category: "Shopping & Personal", subcategory: "Accessories" };
  }

  // ── Electricity ───────────────────────────────────────────────────────────
  if (/\b(meralco|electric\s*(bill|utility)?|kuryente|electricity\s*bill|power\s*bill|soco|veco|cepalco|beneco|davao\s*light|batelec|noreco|pelco|suleco|quezelco)\b/.test(n)) {
    return { category: "Utilities & Home", subcategory: "Electricity" };
  }

  // ── Water ────────────────────────────────────────────────────────────────
  if (/\b(maynilad|manila\s*water|water\s*bill|mwd|mwss|local\s*water(works)?|nawasa|water\s*district|tubig)\b/.test(n)) {
    return { category: "Utilities & Home", subcategory: "Water" };
  }

  // ── Internet ─────────────────────────────────────────────────────────────
  if (/\b(pldt|globe\s*fiber|converge|sky\s*cable|sky\s*broadband|rise\s*broadband|eastern\s*telecom|cignal|internet\s*bill|broadband\s*bill|wifi\s*bill|fiber\s*internet)\b/.test(n)) {
    return { category: "Utilities & Home", subcategory: "Internet" };
  }

  // ── Phone bill / Load ─────────────────────────────────────────────────────
  if (/\b(globe|smart|dito\s*telecom|sun\s*cellular|tnt|talk\s*n\s*text|phone\s*bill|load|e[- ]?load|prepaid|postpaid|sim\s*card|gcash\s*load|maya\s*load|mobile\s*data)\b/.test(n)) {
    return { category: "Utilities & Home", subcategory: "Phone Bill" };
  }

  // ── Rent / Mortgage ────────────────────────────────────────────────────────
  if (/\b(rent|condo\s*(fee|dues?|association)?|apartment|mortgage|lease|monthly\s*dues?|association\s*dues?|homeowner['']?s\s*fee|hoa\s*fee|amortization)\b/.test(n)) {
    return { category: "Utilities & Home", subcategory: "Rent/Mortgage" };
  }

  // ── Home repair ───────────────────────────────────────────────────────────
  if (/\b(home\s*depot|ace\s*hardware|wilcon|handyman|true\s*value|hardware\s*store|plumbing|electrician|carpenter|mason|painter|renovation|construction|repair\s*(service|shop)?|aircon\s*(cleaning|repair|service)|appliance\s*repair|maintenance\s*service)\b/.test(n)) {
    return { category: "Utilities & Home", subcategory: "Home Repair" };
  }

  // ── Furniture ────────────────────────────────────────────────────────────
  if (/\b(sm\s*home|sm\s*homeworld|ikea|landmark\s*home|robinsons\s*home|western\s*appliances|abenson\s*home|uratex|furniture\s*(store|shop)?|sofa|cabinet|table|chairs?|bed\s*frame|mattress|sala\s*set|dining\s*set|wardrobe|aparador|lemery)\b/.test(n)) {
    return { category: "Utilities & Home", subcategory: "Furniture" };
  }

  // ── Education: Tuition ────────────────────────────────────────────────────
  if (/\b(tuition|enrollment\s*fee|school\s*fee|registration\s*fee|miscellaneous\s*fee|university\s*fee|college\s*fee|ateneo|dlsu|la\s*salle|ust|up\s*diliman|mapua|feu|adamson|pamantasan|pup|plm|nsc|tesda|deped)\b/.test(n)) {
    return { category: "Education", subcategory: "Tuition" };
  }

  // ── Education: Books & Materials ─────────────────────────────────────────
  if (/\b(textbook|school\s*supplies?|notebook|pad\s*paper|bond\s*paper|pen|pencil|ballpen|highlighter|ruler|backpack|school\s*bag|art\s*materials?|drawing\s*materials?)\b/.test(n)) {
    return { category: "Education", subcategory: "Books & Materials" };
  }

  // ── Education: Online Courses ─────────────────────────────────────────────
  if (/\b(udemy|coursera|skillshare|linkedin\s*learning|edx|pluralsight|masterclass|online\s*course|e[- ]?learning|webinar\s*fee|training\s*fee|seminar\s*fee|workshop\s*fee)\b/.test(n)) {
    return { category: "Education", subcategory: "Online Courses" };
  }

  // ── Education general ─────────────────────────────────────────────────────
  if (/\b(school|university|college|education|academ)\b/.test(n)) {
    return { category: "Education", subcategory: "Supplies" };
  }

  // ── Flights ───────────────────────────────────────────────────────────────
  if (/\b(cebu\s*pacific|cebu\s*pac|cebupac|philippine\s*airlines?|pal\s*express|airasia|air\s*asia|jetstar|scoot|singapore\s*airlines?|cathay|emirates|air\s*france|lufthansa|delta|united\s*airlines?|alaska\s*airlines?|southwest|ryanair|easyjet|flight|airline|airfare|plane\s*ticket|boarding\s*pass)\b/.test(n)) {
    return { category: "Travel & Vacation", subcategory: "Flights" };
  }

  // ── Hotels ────────────────────────────────────────────────────────────────
  if (/\b(hotel|resort|inn|hostel|airbnb|booking\.com|agoda|expedia|trivago|peninsula|shangri[- ]?la|marriott|hilton|hyatt|accor|radisson|seda|okada|solaire|city\s*of\s*dreams|sofitel|pan\s*pacific|discovery\s*suites?|crimson\s*hotel|accommodation|lodging|guesthouse|bed\s*&\s*breakfast|b&b)\b/.test(n)) {
    return { category: "Travel & Vacation", subcategory: "Hotels" };
  }

  // ── Tours & Activities ────────────────────────────────────────────────────
  if (/\b(tour\s*(package|fee|operator)?|island\s*hopping|day\s*tour|heritage\s*tour|entrance\s*fee\s*(park|museum|zoo|nature)|amusement\s*park|theme\s*park|enchanted\s*kingdom|ek|star\s*city|ocean\s*park|zoo|aquarium|museum|national\s*park|nature\s*reserve|activity\s*fee|excursion)\b/.test(n)) {
    return { category: "Travel & Vacation", subcategory: "Tours & Activities" };
  }

  // ── Travel insurance ──────────────────────────────────────────────────────
  if (/\b(travel\s*insurance|travel\s*protect|passport\s*fee|visa\s*fee|visa\s*application|travel\s*tax|terminal\s*fee|airport\s*tax)\b/.test(n)) {
    return { category: "Travel & Vacation", subcategory: "Travel Insurance" };
  }

  // ── App Subscriptions ─────────────────────────────────────────────────────
  if (/\b(apple\s*one|apple\s*icloud|icloud\s*storage|google\s*one|google\s*storage|microsoft\s*365|office\s*365|adobe\s*creative|canva\s*pro|figma|notion|slack|zoom|dropbox|todoist|1password|nordvpn|expressvpn|grammarly|duolingo\s*plus|app\s*subscription|saas|monthly\s*subscription|annual\s*subscription)\b/.test(n)) {
    return { category: "Subscriptions & Memberships", subcategory: "App Subscriptions" };
  }

  // ── Club memberships ──────────────────────────────────────────────────────
  if (/\b(club\s*membership|annual\s*membership\s*fee|country\s*club\s*fee|costco\s*membership|landers\s*membership|s&r\s*membership|warehouse\s*club\s*membership|professional\s*membership|association\s*membership\s*fee)\b/.test(n)) {
    return { category: "Subscriptions & Memberships", subcategory: "Club Memberships" };
  }

  // ── Premium services ──────────────────────────────────────────────────────
  if (/\b(premium\s*service|concierge|vip\s*pass|priority\s*pass|lounge\s*access|premium\s*membership|premium\s*plan)\b/.test(n)) {
    return { category: "Subscriptions & Memberships", subcategory: "Premium Services" };
  }

  // ── Gifts ─────────────────────────────────────────────────────────────────
  if (/\b(gift\s*(shop|store|wrap|card|certificate)?|regalo|pasalubong|souvenir|flower\s*(shop|delivery)?|florist|greeting\s*card)\b/.test(n)) {
    return { category: "Other", subcategory: "Gifts" };
  }

  // ── Donations ─────────────────────────────────────────────────────────────
  if (/\b(donation|charity|ngo|relief\s*fund|fundrais|advocacy|foundation\s*donation|tithe|offering|church\s*collection)\b/.test(n)) {
    return { category: "Other", subcategory: "Donations" };
  }

  return { category: "Other", subcategory: "Uncategorized" };
}

// ---------------------------------------------------------------------------
// TabScanner API
// ---------------------------------------------------------------------------

const TABSCANNER_BASE = "https://api.tabscanner.com/api";

interface TabScannerSubmitResponse {
  status: string;
  token?: string;
  message?: string;
}

interface TabScannerLineItem {
  description?: string;
  lineType?: string;
  amount?: number | string;
  qty?: number | string;
}

interface TabScannerResult {
  total?: number | string;
  subtotal?: number | string;
  date?: string;
  establishment?: string;
  lineItems?: TabScannerLineItem[];
  currency?: string;
  receiptNumber?: string;
}

interface TabScannerPollResponse {
  status: string;
  result?: TabScannerResult;
  message?: string;
}

async function submitToTabScanner(
  fileName: string,
  mimeType: string,
  buffer: Buffer
): Promise<string> {
  const apiKey = env.TABSCANNER_API_KEY;
  if (!apiKey) throw new Error("TABSCANNER_API_KEY not configured");

  const form = new globalThis.FormData();
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  form.append("file", new Blob([arrayBuffer], { type: mimeType }), fileName);

  const response = await fetch(`${TABSCANNER_BASE}/2/process`, {
    method: "POST",
    headers: { apikey: apiKey },
    body: form,
    signal: AbortSignal.timeout(30_000)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`TabScanner submit error ${response.status}: ${body}`);
  }

  const data = await response.json() as TabScannerSubmitResponse;
  if (!data.token) {
    throw new Error(`TabScanner did not return a token: ${JSON.stringify(data)}`);
  }
  return data.token;
}

async function pollTabScanner(token: string): Promise<TabScannerResult> {
  const apiKey = env.TABSCANNER_API_KEY!;
  const maxAttempts = 20;
  const intervalMs = 2_000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    const response = await fetch(`${TABSCANNER_BASE}/result/${token}`, {
      headers: { apikey: apiKey },
      signal: AbortSignal.timeout(15_000)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`TabScanner poll error ${response.status}: ${body}`);
    }

    const data = await response.json() as TabScannerPollResponse;

    if (data.status === "done" && data.result) {
      return data.result;
    }

    if (data.status === "failed" || data.status === "error") {
      throw new Error(`TabScanner processing failed: ${data.message ?? "unknown error"}`);
    }

    // status is "pending" or "processing" — keep polling
  }

  throw new Error("TabScanner timed out after 40 seconds");
}

function parseTabScannerAmount(value?: number | string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = typeof value === "string" ? parseFloat(value.replace(/,/g, "")) : value;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// Bus/jeepney tickets use "Amount Due : P63" format which TabScanner doesn't
// recognise as a standard receipt total. It often returns the ticket number,
// vehicle number, or time digits as the total instead.
function isBusTicket(result: TabScannerResult): boolean {
  const allText = [
    result.establishment ?? "",
    ...(result.lineItems?.map((i) => i.description ?? "") ?? [])
  ].join(" ").toLowerCase();
  return /faretype|amount\s*due|vehicle\s*name|device\s*name|conductor|from\s*:\s*\d|to\s*:\s*\d/.test(allText);
}

function extractBusTicketAmount(result: TabScannerResult): number | undefined {
  for (const item of result.lineItems ?? []) {
    if (!item.description) continue;
    // Match "Amount Due : P63" or "Amount Due: 63.00" etc.
    const m = item.description.match(/amount\s*due\s*[:\-]?\s*[₱P]?\s*(\d+(?:\.\d{1,2})?)/i);
    if (m) {
      const val = parseFloat(m[1]);
      if (Number.isFinite(val) && val > 0 && val < 10000) return val;
    }
    // Also handle if TabScanner structured the amount into item.amount
    if (/amount\s*due/i.test(item.description) && item.amount !== undefined) {
      const val = parseTabScannerAmount(item.amount);
      if (val !== undefined && val < 10000) return val;
    }
  }
  return undefined;
}

function parseTabScannerDate(value?: string): string | undefined {
  if (!value) return undefined;

  // Try multiple patterns TabScanner may return
  const patterns = [
    /\b(\d{4}[\/\-]\d{2}[\/\-]\d{2})/,
    /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i,
    /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})\b/i,
    /\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;

    let raw = match[1].replace(/\//g, "-");

    const numeric = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (numeric) {
      const [, a, b, year] = numeric;
      const aNum = parseInt(a, 10);
      const bNum = parseInt(b, 10);
      raw = aNum > 12 && bNum <= 12 ? `${year}-${b}-${a}` : `${year}-${a}-${b}`;
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return undefined;
}

function buildExtractedText(result: TabScannerResult): string {
  const parts: string[] = [];
  if (result.establishment) parts.push(result.establishment);
  if (result.date) parts.push(`Date: ${result.date}`);
  if (result.total !== undefined) parts.push(`Total: ${result.total}`);
  if (result.lineItems?.length) {
    const items = result.lineItems
      .filter((i) => i.description && i.lineType !== "total")
      .map((i) => i.description!)
      .join(", ");
    if (items) parts.push(items);
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Main export: processReceiptWithAI (TabScanner implementation)
// ---------------------------------------------------------------------------

export async function processReceiptWithAI(
  fileName: string,
  mimeType: string,
  buffer: Buffer
): Promise<ParsedReceipt> {
  if (!env.TABSCANNER_API_KEY) {
    // No TabScanner key — fall back to legacy pipeline
    const { processReceiptWithAI: legacyProcess } = await import("./ocrService.legacy");
    return legacyProcess(fileName, mimeType, buffer);
  }

  const token = await submitToTabScanner(fileName, mimeType, buffer);
  const result = await pollTabScanner(token);

  // Bus/jeepney tickets confuse TabScanner — it picks up ticket numbers or
  // time digits (e.g. 19:55:44 → 19) instead of the actual "Amount Due" fare.
  // Detect and fix before we use the total.
  let amount: number | undefined;
  if (isBusTicket(result)) {
    amount = extractBusTicketAmount(result);
    // If we couldn't find Amount Due in line items, try TabScanner's total only
    // when it looks like a realistic fare (≤ 500 PHP).
    if (amount === undefined) {
      const tsAmount = parseTabScannerAmount(result.total);
      if (tsAmount !== undefined && tsAmount <= 500) amount = tsAmount;
    }
  } else {
    amount = parseTabScannerAmount(result.total);
  }
  // Always use today's date — receipt dates are often misprinted or wrong
  const incurredAt = new Date().toISOString();
  const merchant = result.establishment?.trim().slice(0, 80) || undefined;

  // Build a text summary for category inference and rawText storage
  const extractedText = buildExtractedText(result);

  // Infer category: try merchant name alone first so known brands (e.g. Alfamart)
  // always win over line-item keywords (e.g. "pizza", "grill") that might fire
  // the wrong subcategory when OCR partially misreads the merchant header.
  const merchantMatch = normalizeCategory(merchant);
  const { category, subcategory } = (merchantMatch.subcategory && merchantMatch.subcategory !== "Uncategorized")
    ? merchantMatch
    : normalizeCategory([
        merchant,
        ...(result.lineItems?.map((i) => i.description).filter(Boolean) ?? [])
      ].join(" "));

  // Sanity check: if TabScanner returned almost nothing, treat as failed
  if (!amount && !merchant) {
    throw new Error("NOT_A_RECEIPT");
  }

  return {
    extractedText,
    amount,
    merchant,
    category,
    subcategory,
    incurredAt,
    parserSource: "tabscanner",
    parserConfidence: amount && merchant ? 0.9 : 0.6,
    llmAttempted: false,
    llmSucceeded: false
  };
}

// ---------------------------------------------------------------------------
// Budget AI — unchanged from legacy
// ---------------------------------------------------------------------------

export interface BudgetPlanAIResult {
  overspendFlags: string[];
  warnings: string[];
}

export async function generateBudgetPlanWithAI(
  weeklyBudget: number,
  categoryAllocations: Record<string, number>,
  expenseData: Array<{ category: string; amount: number }>
): Promise<BudgetPlanAIResult | null> {
  const llmKeys = getLlmApiKeys();
  if (llmKeys.length === 0) return null;

  const llmModel = env.LLM_MODEL || env.OPENAI_MODEL;

  const categoryTotals: { [key: string]: number } = {};
  for (const expense of expenseData) {
    const cat = expense.category || "Uncategorized";
    categoryTotals[cat] = (categoryTotals[cat] || 0) + expense.amount;
  }

  const historySummary = Object.entries(categoryTotals)
    .map(([cat, total]) => `- ${cat}: PHP ${total.toFixed(2)} spent (avg PHP ${(total / 28).toFixed(2)}/day)`)
    .sort()
    .join("\n");

  const allocationSummary = Object.entries(categoryAllocations)
    .map(([cat, limit]) => {
      const histSpent = categoryTotals[cat] ?? 0;
      const weeklyHistAvg = histSpent / 4;
      return `- ${cat}: user set PHP ${limit.toFixed(2)}/week (historical avg PHP ${weeklyHistAvg.toFixed(2)}/week)`;
    })
    .join("\n");

  const prompt = [
    `You are a personal budget advisor. A user has set a weekly budget of PHP ${weeklyBudget} with their own category limits.`,
    ``,
    `User's category allocations vs historical spending:`,
    allocationSummary,
    ``,
    `Full historical spending (past 4 weeks):`,
    historySummary,
    ``,
    `Analyze the user's own allocations against their real spending history and return:`,
    `- overspendFlags: array of category names where the user historically spends MORE than their set limit`,
    `- warnings: array of 2-3 concise, actionable recommendations (flag tight allocations, highlight risky categories, suggest adjustments)`,
    ``,
    `Return ONLY valid JSON with exactly these two fields. No markdown, no explanation.`,
    `{ "overspendFlags": [...], "warnings": [...] }`
  ].join("\n");

  for (const llmKey of llmKeys) {
    const isOpenRouterKey = llmKey.startsWith("sk-or-");
    const llmBaseUrl = env.LLM_BASE_URL || (isOpenRouterKey ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1");

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${llmKey}`,
        "Content-Type": "application/json"
      };
      if (llmBaseUrl.includes("openrouter.ai")) {
        headers["HTTP-Referer"] = resolveAppReferer();
        headers["X-Title"] = "LedgerApp Backend";
      }

      const response = await fetch(`${llmBaseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: llmModel,
          temperature: 0.7,
          messages: [
            { role: "system", content: "You are a strict JSON budget plan generator. Return ONLY valid JSON with no markdown or explanation." },
            { role: "user", content: prompt }
          ]
        })
      });

      if (!response.ok) {
        if (shouldRetryWithNextKey(response.status)) continue;
        return null;
      }

      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;

      const jsonCandidate = extractFirstJsonObject(content);
      if (!jsonCandidate) return null;

      const parsed = JSON.parse(jsonCandidate);
      if (!Array.isArray(parsed.overspendFlags) || !Array.isArray(parsed.warnings)) return null;

      return { overspendFlags: parsed.overspendFlags, warnings: parsed.warnings };
    } catch {
      continue;
    }
  }

  return null;
}
