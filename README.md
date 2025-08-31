# 🎭 SHKSPR_AI — Free, Private, Serverless AI Tools

**SHKSPR_AI** is a suite of 100% **FREE**, **OPEN SOURCE**, privacy-first AI utilities designed for students, educators, and professionals.

The tools leverage a powerful **serverless architecture**, where the frontend application runs entirely in your browser while sensitive API calls are securely handled by lightweight, private backend functions. This approach ensures your data remains secure while enabling advanced features.

🔗 **Live Demo:** [**shkspr.vercel.app**](https://shkspr.vercel.app/)

---

## ✨ Tools Included

Each application is designed to be fast, intuitive, and powerful.

-   ✍️ **AI Humanizer** — Make AI text sound natural, with tone and perspective controls.
-   📝 **AI Summarizer** — Condense text, PDFs, images, or audio into clear summaries.
-   🎓 **Study Guide Generator** — Auto-generate structured study guides and a companion quiz from your notes.
-   🧠 **Quiz Builder** — Build interactive quizzes from any text or document.
-   ✅ **Assignment Grader** — Grade work with custom rubrics and detailed feedback.
-   📚 **Flashcard Generator** — Turn notes into interactive, flippable flashcards.
-   📄 **Citation Generator** — Create formatted citations from text or files.

---

## 🚀 Why Choose SHKSPR_AI?

-   🌟 **Always Free** — No subscriptions, no paywalls. The project is designed to be deployed and used freely.
-   🔐 **Private & Secure by Design** — The frontend runs in your browser, and the backend consists of stateless, serverless functions. Your input data is processed and then immediately discarded—**nothing is ever stored.**
-   🚀 **Powerful Serverless Functions** — By using a lightweight Vercel backend, SHKSPR_AI can:
    -   Securely manage API keys without exposing them in the browser.
    -   Handle complex, long-running AI tasks without timing out.
    -   Integrate with external services (like fetching YouTube transcripts) that are impossible to do from the frontend alone.
-   💻 **Simple Deployment** — The project is optimized for one-click deployment on Vercel. Fork the repository, add your API keys as environment variables, and you're live.

---

## 🛠️ Getting Started & Deployment

You can use the tools directly from the [live demo](https://shkspr.vercel.app/) or deploy your own version.

### One-Click Vercel Deployment

1.  **Fork** this repository to your own GitHub account.
2.  Click the button below to deploy your fork to Vercel.

    [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fsnjzz38%2FSHKSPR_AI)

3.  **Add Environment Variables:** Vercel will prompt you to add environment variables. You will need to add your API keys here (e.g., `GEMINI_API_KEY`). This keeps your keys secure and out of the frontend code.

### Local Development

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/snjzz38/SHKSPR_AI.git
    ```
2.  **Install Vercel CLI:**
    ```bash
    npm i -g vercel
    ```
3.  **Run the development server:**
    ```bash
    vercel dev
    ```
    The application will now be running locally, typically at `localhost:3000`.

## 🛠️ Technology Stack

-   **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES6+)
-   **Backend:** Vercel Serverless Functions (Node.js)
-   **Core AI:** Google Gemini & Groq APIs
-   **Libraries:**
    -   [PDF.js](https://mozilla.github.io/pdf.js/) for reading PDF files.
    -   [Marked.js](https://marked.js.org/) for rendering Markdown in the output.

---

## 🤝 Contributing

Contributions are welcome! If you have an idea for a new tool, a feature enhancement, or a bug fix, please feel free to fork the repository and submit a pull request.

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the `LICENSE` file for details.
