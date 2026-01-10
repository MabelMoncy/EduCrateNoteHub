# 📚 EduCrate

<div align="center">

**A Modern Digital Library for S4 Computer Science & Engineering Students**

[![Live Demo](https://img.shields.io/badge/Live-Demo-success?style=flat-square&logo=vercel)](https://edunotehub.netlify.app)

</div>

---

## 📖 About

**EduCrate** is a modern, elegant digital library designed specifically for S4 Computer Science & Engineering students. Built with simplicity and accessibility in mind, this web application provides a centralized hub for storing, organizing, and accessing course materials, lecture notes, and study resources.

### ✨ Key Features

- 📁 **Subject-Based Organization** - Materials categorized by subject folders for intuitive navigation
- 🔍 **Smart Search** - Real-time search functionality to quickly find the notes you need
- 📱 **Fully Responsive** - Seamless experience across desktop, tablet, and mobile devices
- 🌓 **Dark Mode Support** - Toggle between light and dark themes for comfortable reading
- 📄 **Built-in PDF Viewer** - View documents directly in the browser with download capabilities
- ⚡ **Fast & Lightweight** - Optimized performance with minimal dependencies
- 🎨 **Modern UI/UX** - Clean, intuitive interface built with Tailwind CSS
- 🔒 **Google Drive Integration** - Secure file storage and retrieval

---

## 🛠️ Tech Stack

| Category | Technology |
|----------|-----------|
| **Frontend** | HTML5, Vanilla JavaScript, Tailwind CSS |
| **Backend** | Node.js, Express.js |
| **Storage** | Google Drive API |
| **Deployment** | Netlify |
| **Styling** | Tailwind CSS (CDN) |

---

## 🚀 How to Use

### 👨‍🎓 For Students (End Users)

1. **Browse Subjects** 📚
   - Use the sidebar menu to navigate through different subjects
   - Click on the hamburger menu (mobile) to access subjects

2. **Search Notes** 🔍
   - Click the search icon in the navigation bar
   - Type at least 2 characters to see instant results
   - Click on any result to open the document

3. **View PDFs** 📄
   - Click on any note card to open it in the built-in viewer
   - The viewer loads with a smooth animation

4. **Download** ⬇️
   - Use the "DOWNLOAD" button in the PDF viewer
   - Files are downloaded directly from secure storage

5. **Toggle Theme** 🌓
   - Click the moon/sun icon to switch between dark and light modes
   - Your preference is saved automatically

---

## 💻 For Developers

### Prerequisites

Before you begin, ensure you have the following installed:

```bash
Node.js >= 14.0.0
npm >= 6.0.0 or yarn >= 1.22.0
Git
```

### 📥 Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/MabelMoncy/EduNotes.git
   cd EduNotes
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
   
   Then edit `.env` and add your credentials:
   ```env
   # Google Drive API Configuration
   GOOGLE_CLIENT_ID=your_client_id_here
   GOOGLE_CLIENT_SECRET=your_client_secret_here
   GOOGLE_REFRESH_TOKEN=your_refresh_token_here
   
   # Server Configuration
   PORT=3000
   NODE_ENV=development
   ```

4. **Run the development server**
   ```bash
   npm start
   ```

5. **Access the application**
   
   Open your browser and navigate to: 
   ```
   http://localhost:3000
   ```

### 🗂️ Project Structure

```
EduNotes/
├── public/
│   ├── index.html          # Main HTML file
│   └── script.js           # Frontend JavaScript
├── netlify/
│   └── functions/          # Netlify serverless functions
├── . env.example            # Environment variables template
├── . gitattributes          # Git attributes configuration
├── netlify.toml            # Netlify deployment config
├── package.json            # Project dependencies
├── test-drive.js           # Test script
└── README.md               # Project documentation
```

### 🔧 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/folders` | GET | Get all subject folders |
| `/api/files/: folderId` | GET | Get files in a specific folder |
| `/api/search? q=query` | GET | Search for files across all folders |

### 🚢 Deployment

#### Deploy to Netlify

1. Connect your repository to [Netlify](https://netlify.com)
2. Netlify will use the `netlify.toml` configuration automatically
3. Add environment variables in Netlify dashboard
4. Deploy!

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/MabelMoncy/EduNotes)

---

## 🌐 Live Demo

**🔗 [View Live Demo](https://edunotehub.netlify.app)**

Experience EduCrate in action!  The live demo showcases all features including: 

✅ Subject browsing and navigation  
✅ Real-time search functionality  
✅ PDF viewing and downloading  
✅ Dark/light mode theming  
✅ Mobile-responsive interface  

> **Note**: The demo is populated with educational resources for S4 CS2 students.

---

## 🎨 Features in Detail

### 🌙 Dark Mode
Automatic theme detection based on system preferences with manual toggle option.  Theme preference is persisted in localStorage.

### 🔍 Smart Search
- Debounced search with 500ms delay for optimal performance
- Minimum 2 characters required to trigger search
- Results appear in real-time dropdown
- Highlights PDF files with icons

### 📱 Mobile-First Design
- Hamburger menu for sidebar navigation
- Collapsible search bar on mobile
- Touch-optimized buttons and cards
- Responsive grid layouts

### 📄 PDF Viewer
- Proxied PDF viewing for security
- Loading animations for better UX
- Direct download functionality
- Full-screen modal experience

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!  Feel free to check the [issues page](https://github.com/MabelMoncy/EduNotes/issues).

### Steps to Contribute

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📝 License

This project is created for educational purposes.  Please credit the original author when using or modifying this code.

---

## 👨‍💻 Developer

<div align="center">

**Crafted with ❤️ for S4 CS2 Students**

**[Mabel Anto Moncy](https://github.com/MabelMoncy)**

[![GitHub](https://img.shields.io/badge/GitHub-MabelMoncy-181717?style=flat-square&logo=github)](https://github.com/MabelMoncy)

</div>

---

## 🙏 Acknowledgments

- [Tailwind CSS](https://tailwindcss.com/) for the amazing utility-first CSS framework
- [Vercel](https://vercel.com) for seamless deployment
- [Google Drive API](https://developers.google.com/drive) for file storage
- All S4 CS2 students who inspired this project

---

## 📞 Support

If you have any questions or need help, please: 

- 🐛 [Open an Issue](https://github.com/MabelMoncy/EduNotes/issues)
- 💬 Start a [Discussion](https://github.com/MabelMoncy/EduNotes/discussions)
- ⭐ Star this repository if you find it helpful! 

---

<div align="center">

**Made for Students, By Students** 🎓

⭐ Star this repo if you find it helpful! 

</div>

