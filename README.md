# Chimie Expert 🔬🧪

An advanced AI-powered Chemistry Assistant and real-time Interactive 3D Molecular Modeler. Built as a secure, full-stack application designed to run seamlessly on Google AI Studio, Vercel, or any Node.js container environment.

---

## 🌟 Key Features

1. **3D Molecular Modeling & Visualization**
   - Interactive, real-time 3D molecule rendering utilizing **Three.js** via **React Three Fiber** (`@react-three/fiber` & `@react-three/drei`).
   - Drag, rotate, and interact with classic molecular structures (covalent bonds, sphere/stick layouts) directly inside your browser.

2. **AI Chemistry Tutor (Virtual Teacher)**
   - Personalized organic & inorganic chemistry sessions powered by Google **Gemini 3.5 Flash** models.
   - Live AI whiteboard generation, step-by-step chemical reaction parsing, and academic instruction.
   - Mathematical and chemical formula rendering using **KaTeX** (`katex`, `react-markdown`, `rehype-katex`, `remark-math`).

3. **Intelligent Document & Course Notes Parser**
   - Streamlined drag-and-drop workflow (`react-dropzone`) to analyze real chemistry course notes.
   - Pre-configured parsers for PDF document pages (`pdfjs-dist`) and Word documents (`mammoth`).
   - Extract raw text data to dynamically build a personalized local/cloud chemistry knowledge base.

4. **Dynamic AI Quiz Generator**
   - Automatically generates randomized interactive evaluation quizzes from your materials or custom prompts.
   - Tracks correct answers, scores, and delivers immediate chemistry feedback on chemical equations.

5. **Cloud Persistence & Google Authentication**
   - Built-in **Firebase Authentication** providing secure single-click sign-in with Google.
   - Cloud-backed data synchronization using **Cloud Firestore** storing teacher chats, customized courses, and personal profile analytics.

---

## 🛠️ Tech Stack & Key Libraries

### Frontend
- **Framework**: React 19 (Vite-powered Single-Page Application environment)
- **Styling**: Tailwind CSS v4.0 (for modern, highly responsive design) & Tailwind Animated CSS
- **Animations**: Motion (`motion/react`) for smooth page transitions and micro-interactions
- **3D Graphics**: Three.js & React Three Fiber (`@react-three/fiber`, `@react-three/drei`)
- **Icons**: Lucide React (`lucide-react`)
- **Scientific Typography**: KaTeX (`katex`, `react-markdown`, `rehype-katex`, `remark-math`) for high-fidelity LaTeX equations

### Backend & AI Gateway
- **Runtime**: Node.js & TypeScript (`tsx` for native TypeScript execution)
- **Framework**: Express (lightweight server-side proxy layers)
- **AI SDK**: Google Gen AI SDK (`@google/genai`)
- **Server Bundler**: Esbuild (compiled to a highly optimized single production bundle `dist/server.cjs`)
- **Security Check**: Enforced `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` configuration to securely delegate LLM execution server-side, safeguarding API credentials.

---

## 🏗️ Technical Architecture & Security

To prevent sensitive API credential leaks (such as exposing your `GEMINI_API_KEY` to the client-side browser console), **Chimie Expert** runs in a modern **Full-Stack Proxy Architecture**:

```
[Browser / Client App]
         │
         ▼ (Fetch Requests / API requests)
[Node.js Express Server (server.ts)]  ◄─── Reads process.env.GEMINI_API_KEY (Securely hidden)
         │
         ▼ (Google Gen AI SDK)
[Google Gemini REST Endpoints]
```

- **Vite Middleware (Development)**: During local dev, Express injects the Vite server as middleware, automatically maintaining asset resolution & hot module reloads under a unified local host listening on port `3000`.
- **Static Ingress (Production)**: When built, the application assets are compiled to static files in `dist/`. The compiled CommonJS Express server `dist/server.cjs` hosts those assets alongside static routing fallbacks.

---

## 🚀 How to Run the App

### 1. Prerequisites
- **Node.js**: `v18` or newer (Recommended: `v20+`)
- **npm**: `v9` or newer

### 2. Environment Variables Integration
Create a `.env` file in your root folder (reference `.env.example`):
```env
# Google Gemini Credentials (Must be kept secure, never prefixed with VITE_)
GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. Installation
Install the project dependencies safely:
```bash
npm install
```

### 4. Running Locally in Development Mode
Launch both the Vite frontend environment and the Express API gateway running concurrently:
```bash
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

### 5. Building for Production (Vercel / Cloud Run / VPS)
Bundle both the server-side proxy code and frontend client files into optimized bundles:
```bash
npm run build
```
Start the production runtime:
```bash
npm run start
```

---

## 🔒 Firebase Configuration & Access
The application comes preconfigured to connect to your project Firestore database instances.
* To manage your models, auth policies, or Firestore schemas, modify `./firestore.rules` and sync them to your console.
* Detailed connection states are resolved in `./src/lib/firebase.ts`.

---

🔬 **Chemistry Expert AI** — Elevating modern scientific exploration with elegant visual design and state-of-the-art LLMs.
