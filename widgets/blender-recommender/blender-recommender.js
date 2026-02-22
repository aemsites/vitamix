import { loadCSS, loadScript } from '../../scripts/aem.js';

/* eslint-disable */
window.alpineJsBlenderRecommender = (paramLang = 0, paramPrice = 0) => {
    return {
      language: [
        // English
        {
          intro: {
            eyebrow: 'My Blender Recommender',
            headline1: 'First, let&rsquo;s get acquainted. What&rsquo;s your name?',
            nameLabel: 'Name (optional)',
            nameError: 'A valid name is required',
            headline2: 'And your email address?',
            emailLabel: 'Email Address (optional)',
            emailError: 'A valid email address is required',
            promo: 'Not signed up for Vitamix emails yet? You&rsquo;ll get a promo code for <strong>' + ((paramPrice > 0) ? '$20 off' : '$25 off & Free Shipping') + '</strong> on orders of $' + ((paramPrice > 0) ? 300 : 200) + ' or more. Some exclusions may apply.',
            skipButton: 'Skip',
            submitButton: 'Continue',
            submitError: 'Please Correct the Form to Proceed',
          },
          didYouKnow: [
            { eyebrow: 'Why Vitamix?', title: 'Replace over 13 Household Kitchen tools...', desc: 'and simplify the way you prepare whole-foods at home!' },
            { eyebrow: 'Did You Know?', title: 'Vitamix has programmed settings that ensure...', desc: 'walk-away convenience and consistent results for a variety of recipes.' },
            { eyebrow: 'Need Flexibility?', title: 'With 25+ Accessories & Attachments...', desc: 'Vitamix gives you the flexibility to create your own personalized blending system.' },
            { eyebrow: 'Did You Know?', title: 'Vitamix Offers a Wide Range of Colors…', desc: 'to match with your kitchen aesthetic. Available only in select models.' },
          ],
          questions: {
            prevButton: 'Back',
            nextButton: 'Next',
            submitButton: 'Finish',
            q1TabName: 'Blending Needs',
            q1QuestionText: 'what&rsquo;s most important in your new blender?',
            q2TabName: 'The Possibilities',
            q2QuestionText: 'What will you make most?',
            q2QuestionDesc: 'Check all that apply',
            q3TabName: 'Serving Size',
            q3QuestionText: 'How many people will you be blending for?',
            q4TabName: 'Style Preferences',
            q4QuestionText: 'What about color and finish options?',
          },
          choices: {
            q1: [
              ['q1_durability', 'Durable & Simple', 'It&rsquo;s powerful, reliable, and has basic features', '/content/dam/vitamix/home/design-system/illustration/durable.svg'],
              ['q1_convenience', 'Convenience', 'Automatic blending programs are important to me', '/content/dam/vitamix/home/design-system/illustration/convenience.svg'],
              ['q1_style', 'Style & Premium Features', 'Premium color options, attachment compatibility, and the most advanced Blending Programs', '/content/dam/vitamix/home/design-system/illustration/stylish.svg']
            ],
            q2: [
              ['q2_smoothies', 'Smoothies'],
              ['q2_mealprep', 'Meal Prep'],
              ['q2_babyfoods', 'Baby Food'],
              ['q2_baking', 'Baked Goods'],
              ['q2_hotsoups', 'Hot Soups'],
              ['q2_nutbutters', 'Nut butters'],
              ['q2_dressings', 'Dressings'],
              ['q2_desserts', 'Desserts'],
              ['q2_cocktails', 'Cocktails'],
              ['q2_seasonings', 'Spice Blends'],
              ['q2_foodprocessing', 'Food Processing'],
              ['q2_frozendrinks', 'Frozen/Café Drinks'],
              ['q2_foodjuices', 'Whole Food Juices'],
              ['q2_nondairy', 'Non-Dairy Milk'],
              ['q2_smoothiebowls', 'Smoothie Bowls'],
            ],
            q3: [
              ['q3_self', 'Just Me', '', '/content/dam/vitamix/home/design-system/illustration/individual.svg'],
              ['q3_2-4', '2-4 Individuals', '', '/content/dam/vitamix/home/design-system/illustration/2-4.svg'],
              ['q3_4+', '4+ Individuals', '', '/content/dam/vitamix/home/design-system/illustration/4+.svg'],
            ],
            q4: [
              ['q4_colors', 'I Want a Variety of Color Options', '', '/content/dam/vitamix/home/design-system/illustration/color-variety.svg'],
              ['q4_basic', 'I Prefer Basic Colors', '', '/content/dam/vitamix/home/design-system/illustration/color-basic.svg'],
            ]
          },
          results: {
            loadingText1: 'Thanks',
            loadingText2: '! Mixing up your results now...',
            title: 'Meet Your New Blender',
            desc: '<i>Personalized</i> Blender Recommendations',
            summary1: 'What&rsquo;s most important to me is ',
            summary2: ' and making things like ',
            summary3: ' for ',
            summary4: '. And',
            buttonTitle: 'More Details',
            recommendationsTitle: 'Recommended Because',
            startoverEyebrow: 'Start Over?',
            startoverTitle: 'Shake Up Your Results',
            startoverButton: 'Restart',
          },
          iconSection: {
            eyebrow: 'Features & Details',
            title: 'Simple & Versatile',
            desc: 'Vitamix blenders are designed to break down any ingredient - fibrous greens, frozen - solid strawberries, almonds, and more',
            ctaText: 'Why Buy a Vitamix',
            ctaLink: '/why-vitamix',
            items: [
              { title: 'Free Shipping', desc: 'Free Shipping for All Blenders & Containers', icon: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/illustration/free-shipping.svg' },
              { title: 'Take it For a Spin', desc: 'We know you&rsquo;ll love our blenders so we offer a 60-day worry-free trial period.', icon: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/illustration/60-day-trial.svg' },
              { title: 'Flexible Payment', desc: 'Choose how to pay at your own pace. Affirm helps start blending sooner.', icon: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/illustration/affirm.svg' },
              { title: 'Automatic Registration', desc: '', icon: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/illustration/auto-registration.svg' },
              { title: 'Industry Leading Support', desc: 'We offer a wide range of support options to Vitamix customers, from full warranties to on-call Vitamix experts to blending tips, guides, and recipes.', icon: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/illustration/support.svg' },
              { title: 'Expert Customer Service', desc: 'Our customer care team consists of trained Vitamix experts who can help troubleshoot issues, and even suggest new recipes to try.', icon: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/illustration/customer-service.svg' },
              { title: 'Free Shipping on Repairs', desc: 'If your machine is ever in need of repair, we&rsquo;ll pay for shipping both ways.', icon: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/illustration/shipping-repairs.svg' },
              { title: 'Less Than 2% Sent in for Repair', desc: 'Our products are built to last, even when blending the toughest ingredients.', icon: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/illustration/percentage-repaired.svg' },
            ]
          },
          recipeSection: {
            eyebrow: 'Recipes to Try With',
            title: 'Your New Machine',
            ctaText: 'View all Recipes',
            ctaLink: '/recipes',
            articleCTAText: 'View Recipe',
            items: [
              { eyebrow: 'Appetizers', title: 'Sweet and Sour Cucumber and Watermelon Salad', difficulty: 'Intermediate', time: '15 Minutes', image: 'https://www.vitamix.com/content/dam/vitamix/migration/media/other/images/s/Sweet-and-Sour-Cucumber-and-Watermelon-Salad.jpg' },
              { eyebrow: 'Appetizers', title: 'Recipe 2', difficulty: 'Intermediate', time: '15 Minutes', image: 'https://www.vitamix.com/content/dam/vitamix/migration/media/other/images/s/Sweet-and-Sour-Cucumber-and-Watermelon-Salad.jpg' },
              { eyebrow: 'Appetizers', title: 'Recipe 3', difficulty: 'Intermediate', time: '15 Minutes', image: 'https://www.vitamix.com/content/dam/vitamix/migration/media/other/images/s/Sweet-and-Sour-Cucumber-and-Watermelon-Salad.jpg' },
              { eyebrow: 'Appetizers', title: 'Recipe 4', difficulty: 'Intermediate', time: '15 Minutes', image: 'https://www.vitamix.com/content/dam/vitamix/migration/media/other/images/s/Sweet-and-Sour-Cucumber-and-Watermelon-Salad.jpg' },

            ]
          },
          warrantySection: {
            eyebrow: 'We Have You Covered',
            title: 'Up To a 10-Year Full Warranty',
            desc: 'Our full warranties cover parts, performance, and return shipping both ways. Since fewer than 2% of the products in the U.S. currently under warranty have been returned to us for service, it&rsquo;s the best warranty you&rsquo;ll probably never need.',
            image1: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/component/ognm-merchandising-banner-two-image/warranty-10-years.svg',
            image1Alt: '10 Year Warranty',
            image2: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/component/ognm-merchandising-banner-two-image/knockout-replacement-warranty-banner-sq-2@2x.jpg',
            image2Alt: 'Image of 3 Blenders'
          },
          articleSection: {
            items: [
              { eyebrow: '11.10.2022', title: 'How We Built a Better Blender', desc: 'Get an inside look at what sets Vitamix blenders apart. Among people who like to cook, or are interested in chef-quality…', ctaText: 'Read More', link: '/articles/how-we-built-a-better-blender', image: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/component/ognm-cardlist-articles-featured/better-blender-article-sml.jpg' },
              { eyebrow: '03.10.2023', title: 'Pay at Your Own Pace', desc: 'Next time you&rsquo;re shopping with us, just select Affirm at checkout and choose how you want to pay — from 4 interest-free…', ctaText: 'Read More', link: '/about-affirm', image: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/component/ognm-cardlist-articles-featured/payment-plans-article-sml.jpg' },
            ]
          },
          reviews: [
            { name: 'Customer 1', title: 'Home Chef', text: 'I bought my first Vitamix shortly after I was married in 1960. The Vitamix made my life easier because, at the time, nothing like it existed! 62 years later, we&rsquo;re still going strong and the blender works as well as it did in 1960.' },
            { name: 'Customer 2', title: 'Home Chef', text: 'I bought my first Vitamix shortly after I was married in 1960. The Vitamix made my life easier because, at the time, nothing like it existed! 62 years later, we&rsquo;re still going strong and the blender works as well as it did in 1960.' },
            { name: 'Customer 3', title: 'Home Chef', text: 'I bought my first Vitamix shortly after I was married in 1960. The Vitamix made my life easier because, at the time, nothing like it existed! 62 years later, we&rsquo;re still going strong and the blender works as well as it did in 1960.' },
            { name: 'Customer 4', title: 'Home Chef', text: 'I bought my first Vitamix shortly after I was married in 1960. The Vitamix made my life easier because, at the time, nothing like it existed! 62 years later, we&rsquo;re still going strong and the blender works as well as it did in 1960.' },
            { name: 'Customer 5', title: 'Home Chef', text: 'I bought my first Vitamix shortly after I was married in 1960. The Vitamix made my life easier because, at the time, nothing like it existed! 62 years later, we&rsquo;re still going strong and the blender works as well as it did in 1960.' },
          ],
        },
        // French
        {
          intro: {
            eyebrow: 'Guide des mélangeurs',
            headline1: 'D&rsquo;abord, faisons connaissance. Quel est votre nom',
            nameLabel: 'Nom (en option)',
            nameError: 'Une nom valide est requise',
            headline2: 'Et votre adresse de courriel?',
            emailLabel: 'Adresse Courriel (en option)',
            emailError: 'Une adresse de courriel valide est requise',
            promo: 'Vous n&rsquo;êtes pas encore inscrit aux courriels de Vitamix? Vous obtiendrez un code promotionnel de 20 $ de rabais sur les commandes de 300 $ ou plus. Certaines exclusions pourraient s&rsquo;appliquer.',
            skipButton: 'Passer',
            submitButton: 'Continuer',
            submitError: 'Veuillez corriger les erreurs ci-dessous',
          },
          didYouKnow: [
            { eyebrow: 'Pourquoi choisir Vitamix', title: 'Construit pour durer', desc: 'Les mélangeurs Vitamix durent jusqu&rsquo;à 10 fois plus longtemps qu&rsquo;un mélangeur moyen.' },
            { eyebrow: 'Le saviez-vous?', title: 'Vitamix a des programmes de mélange prédéfinis qui garantissent...', desc: 'Commodité immédiate et résultats cohérents pour une variété de types de recettes.' },
            { eyebrow: 'Besoin de flexibilité?', title: 'Avec une gamme de contenants, d&rsquo;accessoires, de & pièces jointes...', desc: 'Vitamix vous offre la flexibilité de créer votre propre système de cuisine personnalisé.' },
            { eyebrow: 'Le saviez-vous?', title: 'Vitamix offre une large gamme de couleurs...', desc: 'Pour s&rsquo;agencer à l&rsquo;esthétique de votre cuisine. Disponible sur certains modèles.' },
          ],
          questions: {
            prevButton: 'Le Verso',
            nextButton: 'Suivant',
            submitButton: 'Conclure',
            q1TabName: 'Mélanger les besoins',
            q1QuestionText: 'qu&rsquo;est-ce qui est le plus important dans votre nouveau mixeur?',
            q2TabName: 'Les possibilités',
            q2QuestionText: 'Qu&rsquo;allez-vous faire le plus?',
            q2QuestionDesc: 'Cochez ce qui s&rsquo;applique',
            q3TabName: 'taille de service',
            q3QuestionText: 'Pour combien de personnes allez-vous mélanger?',
            q4TabName: 'Préférences de style',
            q4QuestionText: 'Qu&rsquo;en est-il des options de couleur et de finition?',
          },
          choices: {
            q1: [
              ['q1_durability', 'Durable et simple', 'Il est puissant, fiable et possède des fonctionnalités de base', '/content/dam/vitamix/home/design-system/illustration/durable.svg'],
              ['q1_convenience', 'Commodité', 'Les programmes de mélange automatique sont importants pour moi', '/content/dam/vitamix/home/design-system/illustration/convenience.svg'],
              ['q1_style', 'Style et fonctionnalités premium', 'Options de couleurs de qualité supérieure, compatibilité avec les accessoires et les programmes de mélange les plus avancés', '/content/dam/vitamix/home/design-system/illustration/stylish.svg']
            ],
            q2: [
              ['q2_smoothies', 'Smoothies'],
              ['q2_mealprep', 'Préparation des repas'],
              ['q2_babyfoods', 'Aliments pour bébés'],
              ['q2_baking', 'Boulangerie'],
              ['q2_hotsoups', 'Soupes chaudes'],
              ['q2_nutbutters', 'Beurres de noix'],
              ['q2_dressings', 'Pansements'],
              ['q2_desserts', 'Desserts'],
              ['q2_seasonings', 'Assaisonnements'],
              ['q2_cocktails', 'Cocktails'],
              ['q2_foodprocessing', 'Traitement des aliments'],
              ['q2_frozendrinks', 'Boissons Glacées/Café'],
              ['q2_foodjuices', 'Jus d&rsquo;aliments entiers'],
              ['q2_nondairy', 'Le lait sans produits laitiers'],
              ['q2_smoothiebowls', 'Bols à smoothies'],
            ],
            q3: [
              ['q3_self', 'Juste moi', '', '/content/dam/vitamix/home/design-system/illustration/individual.svg'],
              ['q3_2-4', '2 à 4 personnes', '', '/content/dam/vitamix/home/design-system/illustration/2-4.svg'],
              ['q3_4+', 'Plus de 4 personnes', '', '/content/dam/vitamix/home/design-system/illustration/4+.svg'],
            ],
            q4: [
              ['q4_colors', 'Je veux une variété d&rsquo;options', '', '/content/dam/vitamix/home/design-system/illustration/color-variety.svg'],
              ['q4_basic', 'Je préfère les couleurs de base', '', '/content/dam/vitamix/home/design-system/illustration/color-basic.svg'],
            ]
          },
          results: {
            loadingText1: 'Merci',
            loadingText2: '! Mélanger vos résultats maintenant...',
            title: 'voici votre nouveau mélangeur',
            desc: '<i>Recommandations personnalisées</i> sur les mélangeurs',
            summary1: 'Ce qui est le plus important pour moi est ',
            summary2: ' et de faire des choses comme ',
            summary3: ' pour ',
            summary4: '. Et ',
            buttonTitle: 'Plus de détails',
            recommendationsTitle: 'Recommandé, car',
            startoverEyebrow: 'Recommencer?',
            startoverTitle: 'Bousculez vos résultats',
            startoverButton: 'Repartir',
          },
          iconSection: {
            eyebrow: 'Caractéristiques et détails',
            title: 'Simple et polyvalent',
            desc: 'Les mélangeurs Vitamix sont conçus pour décomposer tous les ingrédients : légumes verts fibreux, surgelés, fraises solides, amandes, etc.',
            ctaText: 'Pourquoi acheter chez Vitamix?',
            ctaLink: '/why-vitamix',
            items: [
              { title: 'Livraison gratuite', desc: 'Livraison gratuite pour tous les mélangeurs et récipients', icon: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/illustration/free-shipping.svg' },
              { title: 'Prend le comme une occasion de changement', desc: 'Nous savons que vous allez adorer nos mélangeurs, nous offrons donc une période d&rsquo;essai de jours sans souci.', icon: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/illustration/60-day-trial.svg' },
              { title: 'Avantage flexible du paiement', desc: 'Choisissez comment payer à votre rythme. Affirm aide à commencer à mélanger plus tôt.', icon: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/illustration/affirm.svg' },
              { title: 'Enregistrement automatique', desc: '', icon: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/illustration/auto-registration.svg' },
              { title: 'Un soutien de premier plan dans l&rsquo;industrie', desc: 'Chez Vitamix, nous sommes là pour vous, que ce soit en vous offrant des garanties complètes ou en mettant à votre disposition des experts Vitamix, ou encore en vous donnant des conseils, des guides et des recettes pour mélanger comme un pro.', icon: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/illustration/support.svg' },
              { title: 'Service à la clientèle expert', desc: 'Notre équipe de service à la clientèle se compose d&rsquo;experts Vitamix formés qui peuvent vous aider à résoudre les problèmes, et même suggérer de nouvelles recettes à essayer.', icon: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/illustration/customer-service.svg' },
              { title: 'Livraison gratuite sur les réparations', desc: 'Si votre appareil a besoin d&rsquo;être réparé, nous paierons les deux modes d&rsquo;expédition.', icon: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/illustration/shipping-repairs.svg' },
              { title: 'Moins de 2 % d&rsquo;articles envoyés pour réparation', desc: 'Nos produits sont conçus pour durer, même en mélangeant les ingrédients les plus coriaces.', icon: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/illustration/percentage-repaired.svg' },
            ]
          },
          recipeSection: {
            eyebrow: 'Recettes à essayer avec',
            title: 'Votre nouvelle machine',
            ctaText: 'Voir les Recettes',
            ctaLink: '/recipes',
            articleCTAText: 'Voir la Recette',
            items: [
              { eyebrow: 'Appetizers', title: 'Sweet and Sour Cucumber and Watermelon Salad', difficulty: 'Intermediate', time: '15 Minutes', image: 'https://www.vitamix.com/content/dam/vitamix/migration/media/other/images/s/Sweet-and-Sour-Cucumber-and-Watermelon-Salad.jpg' },
              { eyebrow: 'Appetizers', title: 'Recipe 2', difficulty: 'Intermediate', time: '15 Minutes', image: 'https://www.vitamix.com/content/dam/vitamix/migration/media/other/images/s/Sweet-and-Sour-Cucumber-and-Watermelon-Salad.jpg' },
              { eyebrow: 'Appetizers', title: 'Recipe 3', difficulty: 'Intermediate', time: '15 Minutes', image: 'https://www.vitamix.com/content/dam/vitamix/migration/media/other/images/s/Sweet-and-Sour-Cucumber-and-Watermelon-Salad.jpg' },
              { eyebrow: 'Appetizers', title: 'Recipe 4', difficulty: 'Intermediate', time: '15 Minutes', image: 'https://www.vitamix.com/content/dam/vitamix/migration/media/other/images/s/Sweet-and-Sour-Cucumber-and-Watermelon-Salad.jpg' },

            ]
          },
          warrantySection: {
            eyebrow: 'NOUS AVONS CE QU&rsquo;IL VOUS FAUT',
            title: 'Garantie complète de 10 ans',
            desc: 'Notre garantie complète couvre les pièces, la performance et les frais de port aller-retour. Moins de 2 % des appareils garantis aux États-Unis ont été retournés à des fins d&rsquo;entretien. C&rsquo;est donc une garantie optimale dont vous n&rsquo;aurez probablement jamais besoin.',
            image1: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/component/ognm-merchandising-banner-two-image/warranty-10-years.svg',
            image1Alt: '10 Year Warranty',
            image2: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/component/ognm-merchandising-banner-two-image/knockout-replacement-warranty-banner-sq-2@2x.jpg',
            image2Alt: 'Image of 3 Blenders'
          },
          articleSection: {
            items: [
              { eyebrow: '11.10.2022', title: 'Comment nous avons conçu un meilleur mélangeur', desc: 'Découvrez de l&rsquo;intérieur ce qui distingue les blenders Vitamix. Parmi les personnes qui aiment cuisiner ou qui s&rsquo;intéressent à la', ctaText: 'Lire Davantage', link: '/articles/how-we-built-a-better-blender', image: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/component/ognm-cardlist-articles-featured/better-blender-article-sml.jpg' },
              { eyebrow: '03.10.2023', title: 'Paiement à Votre Rythme', desc: 'La prochaine fois que vous ferez vos achats chez nous, il vous suffira de sélectionner Affirm à la caisse et de choisir votre mod', ctaText: 'Lire Davantage', link: '/about-affirm', image: 'https://www.vitamix.com/content/dam/vitamix/home/design-system/component/ognm-cardlist-articles-featured/payment-plans-article-sml.jpg' },
            ]
          },
          reviews: [
            { name: 'Customer 1', title: 'Home Chef', text: 'I bought my first Vitamix shortly after I was married in 1960. The Vitamix made my life easier because, at the time, nothing like it existed! 62 years later, we&rsquo;re still going strong and the blender works as well as it did in 1960.' },
            { name: 'Customer 2', title: 'Home Chef', text: 'I bought my first Vitamix shortly after I was married in 1960. The Vitamix made my life easier because, at the time, nothing like it existed! 62 years later, we&rsquo;re still going strong and the blender works as well as it did in 1960.' },
            { name: 'Customer 3', title: 'Home Chef', text: 'I bought my first Vitamix shortly after I was married in 1960. The Vitamix made my life easier because, at the time, nothing like it existed! 62 years later, we&rsquo;re still going strong and the blender works as well as it did in 1960.' },
            { name: 'Customer 4', title: 'Home Chef', text: 'I bought my first Vitamix shortly after I was married in 1960. The Vitamix made my life easier because, at the time, nothing like it existed! 62 years later, we&rsquo;re still going strong and the blender works as well as it did in 1960.' },
            { name: 'Customer 5', title: 'Home Chef', text: 'I bought my first Vitamix shortly after I was married in 1960. The Vitamix made my life easier because, at the time, nothing like it existed! 62 years later, we&rsquo;re still going strong and the blender works as well as it did in 1960.' },
          ],
        }
      ],

      // UI Vars
      baseURl: window.location.href,
      timestamp: new Date().valueOf(),
      initialized: false,
      minHeight: 0,
      compact: false,
      currentLanguage: paramLang, // 0 - English, 1 - French
      pricing: paramPrice, // 0 - English, 1 - CAD
      linkPrefix1: '/us',
      linkPrefix2: '/en_us',
      modalLeadSource: 'sub-em-modal-us',
      modalActionURL: '/rest/V1/vitamix-api/newslettersubscribe',
      screen: 1, // 1 - Personal Info, 2 - Questions, 3 - Result Loader, 4 - All Done
      question: 1,
      totalQuestions: 3,
      dykExpanded: false,
      complete: false,

      // inputs
      namefieldValue: '',
      namefieldError: true,
      namefieldCanShowError: false,

      emailfieldValue: '',
      emailfieldError: true,
      emailfieldCanShowError: false,

      emailSubmitted: false,

      // answer data
      answers: {
        question1: '',
        question2: [],
        question3: '',
        question4: '',
      },

      weightedItems: [],
      resultUtm: [
        '?src=vbr&utm_medium-first',
        '?src=vbr&utm_medium-second',
        '?src=vbr&utm_medium-third',
      ],

      // Functions
      init() {
        this.loadData();
        this.loadPosition();
        this.setAppHeight();
        if (this.baseURl.indexOf('vitamix.com') > -1) {
          // Update English / French
          if (this.baseURl.indexOf('/en_us') > -1) {
            this.currentLanguage = 0;
            this.linkPrefix2 = '/en_us';
          }
          else if (this.baseURl.indexOf('/fr_ca') > -1) {
            this.currentLanguage = 1;
            this.linkPrefix2 = '/fr_ca';
          }
          // Update USA / Canada
          if (this.baseURl.indexOf('vitamix.com/us/') > -1) {
            this.pricing = 0;
            this.modalLeadSource = 'sub-em-modal-us';
            this.linkPrefix1 = '/us';
          }
          else if (this.baseURl.indexOf('vitamix.com/ca/') > -1) {
            this.pricing = 1;
            this.modalLeadSource = 'sub-em-modal-ca';
            this.linkPrefix1 = '/ca';
          }
        }
        this.initialized = true;

        this.fetchWeightedItems();

        setTimeout(() => {
          this.$refs.componentbody.classList.remove('is-loading');
        }, 400);

        this.$watch('namefieldValue', () => {
          this.namefieldError = !this.namefieldValue;
        });
        this.namefieldError = !this.namefieldValue;

        this.$watch('emailfieldValue', () => {
          this.emailfieldError = !(/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/.test(this.emailfieldValue));
        });
        this.emailfieldError = !(/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/.test(this.emailfieldValue));

        this.$watch('answers', () => {
          this.weightAndSort();
        });

        window.onresize = this.setAppHeight();
      },

      saveData() {
        try {
          if (this.namefieldValue.length) {
            localStorage.setItem("user", this.namefieldValue);
          }
          if (this.emailfieldValue.length) {
            localStorage.setItem("email", this.emailfieldValue);
          }
          localStorage.setItem("answers", JSON.stringify(this.answers));
        }
        catch (e) {
          console.warn('Error Saving Data:\n' + e);
        }
      },

      loadData() {
        try {
          if (localStorage.getItem("user") !== null) {
            this.namefieldValue = localStorage.getItem("user");
          }
          if (localStorage.getItem("email") !== null) {
            this.emailfieldValue = localStorage.getItem("email");
          }
          if (localStorage.getItem("answers") !== null) {
            this.answers = JSON.parse(localStorage.getItem("answers"));
          }
        }
        catch (e) {
          console.warn('Error Loading Data:\n' + e);
          this.weightedItems.push(JSON.parse(JSON.stringify(item)))
        }
      },



      savePosition() {
        try {
          localStorage.setItem("screen", this.screen);
          localStorage.setItem("question", this.question);
          localStorage.setItem("complete", this.complete);
        }
        catch (e) {
          console.warn('Error Saving Position:\n' + e);
        }
      },

      loadPosition() {
        try {
          if (localStorage.getItem("screen") !== null) {
            this.screen = parseInt(localStorage.getItem("screen"));
          }
          if (localStorage.getItem("question") !== null) {
            this.question = parseInt(localStorage.getItem("question"));
          }
          if (localStorage.getItem("complete") !== null && (localStorage.getItem("complete") == true || localStorage.getItem("complete") == 'true' || localStorage.getItem("complete") == 1)) {
            this.complete = true;
          }
        }
        catch (e) {
          console.warn('Error Loading Position:\n' + e);
          this.weightedItems.push(JSON.parse(JSON.stringify(item)))
        }
      },


      getLanguageSuffix() {
        switch (this.currentLanguage) {
          case 0: return 'en'; break;
          case 1: return 'fr'; break;
        }
      },

      fetchWeightedItems: async function () {
        let response = await fetch('https://www.vitamix.com/content/dam/vitamix/files/blender-recommender-' + this.getLanguageSuffix() + '.json?=' + this.timestamp);
        let responseJSON = await response.json();
        responseJSON.forEach((item, index) => {
          item.calculatedScore = 0;
          // Show em all if this column in the spreadsheet is not present
          if (typeof item.show_us == 'undefined') {
            this.weightedItems.push(JSON.parse(JSON.stringify(item)));
          }
          else if (this.pricing == 0 && typeof item.show_us != 'undefined' && item.show_us == 1) {
            this.weightedItems.push(JSON.parse(JSON.stringify(item))); // clone
          }
          else if (this.pricing == 1 && typeof item.show_ca != 'undefined' && item.show_ca == 1) {
            this.weightedItems.push(JSON.parse(JSON.stringify(item))); // clone
          }
        });
        this.weightAndSort();
      },

      weightAndSort() {
        this.weightedItems.forEach((item, index) => {
          let tally = 0;

          // Answer 1
          if (this.answers.question1.length > 0 && item[this.answers.question1] != 'undefined') {
            tally += item[this.answers.question1];
          }

          // Answer 2
          if (this.answers.question2.length > 0) {
            this.answers.question2.forEach((answerItem, answerIndex) => {
              if (typeof item[answerItem] != 'undefined') {
                tally += item[answerItem];
              }
            });

          }

          // Answer 3
          if (this.answers.question3.length > 0 && item[this.answers.question3] != 'undefined') {
            tally += item[this.answers.question3]
          }

          // Answer 4
          if (this.answers.question4.length > 0 && item[this.answers.question4] != 'undefined') {
            tally += item[this.answers.question4]
          }

          item.calculatedScore = tally;
        });
        this.weightedItems.sort((a, b) => a['result_id'] - b['result_id']);
        this.weightedItems.sort((a, b) => b['calculatedScore'] - a['calculatedScore']);
      },

      getChoice(question, value) {
        return this.language[this.currentLanguage].choices[question][(this.language[this.currentLanguage].choices[question].findIndex((item) => item[0] == value))][1];
      },

      goNext() {
        this.saveData();
        switch (this.screen) {
          case 1:
            if (false/*this.namefieldError || this.emailfieldError */) {
              window.alert(this.language[this.currentLanguage].intro.submitError);
            } else {
              if (!this.emailfieldError) {
                this.submitEmail();
                this.emailSubmitted = true;
              }
              this.screen = 2;
            }
            break;
          case 2:
            if (this.answers['question' + this.question].length > 0) {
              if (this.question >= this.totalQuestions) {
                this.screen = 3;
                window.scrollTo({ top: 0, behavior: 'smooth' });
                setTimeout(() => {
                  this.complete = true;
                  this.savePosition();
                }, 2000);
              } else {
                this.question++;
              };
            }
            else {
              console.warn('Can\'t Skip Steps');
            }
            break;
          default:
          //console.log('Default Action');
        }
        this.savePosition();
      },

      goPrev() {
        this.saveData();
        switch (this.screen) {
          case 3:
            this.screen = 2;
            break;
          case 2:
            if (this.question < 2) {
              this.screen = 1;
            } else {
              this.question--;
            };
            break;
          default:
        }
        this.savePosition();
      },

      goToQuestion(questionNumber) {
        this.screen = 2;
        this.complete = false;
        if (questionNumber < this.question) {
          this.question = questionNumber;
        } else {

          switch (questionNumber) {
            case 1: this.question = questionNumber;
              break;
            case 2:
              if (this.answers.question1.length > 0) {
                this.question = questionNumber;
              }
              else {
                console.warn('Can\'t skip steps...');
              }
              break;
            case 3:
              if (this.answers.question1.length > 0 && this.answers.question2.length > 0) {
                this.question = questionNumber;
              }
              else {
                console.warn('Can\'t skip steps...');
              }
              break;
            case 4:
              if (this.answers.question1.length > 0 && this.answers.question2.length > 0 && this.answers.question3.length > 0) {
                this.question = questionNumber;
              }
              else {
                console.warn('Can\'t skip steps...');
              }
              break;
          }
        }
        this.savePosition();
      },

      qPoz(x) {
        let className = '';
        if (x > this.question) {
          className = 'is-ahead';
        }
        if (x < this.question) {
          className = 'is-behind';
        }
        return className;
      },

      setAppHeight() {
        let headerHeight = 0;
        try {
          headerHeight = window.getComputedStyle(document.querySelector('header'), null).getPropertyValue('height');
        }
        catch (e) {
          console.warn('Failed to Set Header Height: \n' + e);
        }
        this.minHeight = 'min-height: calc(100vh - ' + headerHeight + '); min-height: calc(100dvh - ' + headerHeight + ' );'
      },

      submitEmail() {
        try {
          $.ajax({
            type: "GET",
            url: "https://www.vitamix.com/bin/vitamix/newslettersubscription",
            data: {
              email: this.emailfieldValue,
              mobile: '',
              sms_optin: '',
              lead_source: this.modalLeadSource,
              actionUrl: this.linkPrefix1 + this.linkPrefix2 + this.modalActionURL,
              pageUrl: window.location.href
            },
            success: function (s) {
              console.log('Successfully submitted email:\n');
              console.log(s)
            },
            error: function (e) {
              console.log('Failed to submit email:\n' + e)
            }
          })
        }
        catch (e) {
          console.warn('Unable to submit email to endpoint:\n' + e);
        }
      },

      //Carousel
      carouselCurrentPosition: 1,
      carouselMaxPosition: 3,
      carouselistWrapWidth: 0,
      carouselLastListWrapWidth: 0,
      carouselItemPosition: 0,

      carouselPrev() {
        if (this.carouselCurrentPosition > 1) {
          this.carouselCurrentPosition--;
          this.carouselUpdatePosition();
        }
      },
      carouselNext() {
        if (this.carouselCurrentPosition < this.carouselMaxPosition) {
          this.carouselCurrentPosition++;
          this.carouselUpdatePosition();
        }
      },
      carouselUpdatePosition() {
        if (this.carouselCurrentPosition > 1) {
          this.carouselItemPosition = Math.round(document.getElementById('resultCarouselScroller-item' + this.carouselCurrentPosition).getBoundingClientRect().left - document.getElementById('resultCarouselScroller').getBoundingClientRect().left);
        }
        else {
          this.carouselItemPosition = 0
        }
      }


    }
  };

  loadScript('https://unpkg.com/alpinejs@3.10.3/dist/cdn.min.js', () => {
    alpineJsBlenderRecommender(0,1);    
  });

  loadCSS('https://www.vitamix.com/content/dam/vitamix/client-library/css/design-system.min.css?q=1765483391');
  loadCSS('https://www.vitamix.com/content/dam/vitamix/client-library/css/design-system.min.css?v=1699551075845');