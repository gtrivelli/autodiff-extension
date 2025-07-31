# AutoDiff - AI-Powered Code Review Extension

AutoDiff is a VS Code extension that provides AI-powered code review directly in your editor. It analyzes your Git diffs for security vulnerabilities, accessibility issues, performance problems, and code quality concerns before you commit or create pull requests.

## ✨ Features

- **🔒 Security Review**: Detects potential security vulnerabilities, hardcoded secrets, and unsafe practices
- **♿ Accessibility Review**: Identifies accessibility issues in web code (HTML, CSS, JavaScript)
- **⚡ Performance Review**: Finds performance bottlenecks and optimization opportunities
- **📏 Quality Review**: Checks code quality, best practices, and maintainability

### AI Provider Support

- **External Backend**: Connect to OpenAI and Google Gemini (more LLMs coming)
- **Fallback Support**: Automatic fallback between providers for reliability

## 🚀 Getting Started

### Prerequisites

- VS Code 1.102.0 or higher
- Git repository with changes to review
- Backend server running with API keys for external LLM providers

### Installation

1. Install the extension from the VS Code marketplace
2. The AutoDiff activity bar will appear on the left sidebar
3. Open a Git repository with uncommitted changes

### Quick Start

1. **Make some code changes** in your Git repository
2. **Open the AutoDiff panel** from the activity bar (shield icon)
3. **Select a base branch** to compare against (default: origin/main)
4. **Choose review types** by toggling them in the Reviews section
5. **Click "Run Reviews"** to start the analysis

## 🎮 How to Use

### Basic Workflow

1. **Branch Selection**: Use the "Branch" panel to select which branch to compare your changes against
2. **Review Configuration**: Toggle specific review types in the "Reviews" panel:
   - Security Review
   - Accessibility Review  
   - Performance Review
   - Quality Review
3. **Run Analysis**: Click the play button next to "Run Reviews"
4. **View Results**: Check the "Results" panel for detailed findings
5. **Review Changes**: See affected files in the "Changes" panel

### Available Commands

Access these commands via the Command Palette (`Ctrl+Shift+P`):

- `AutoDiff: Run Security Review` - Analyze for security issues
- `AutoDiff: Run Accessibility Review` - Check accessibility compliance
- `AutoDiff: Run Performance Review` - Find performance issues
- `AutoDiff: Run Quality Review` - Review code quality

## ⚙️ Configuration

### Backend Setup (for External LLM Providers)

If you want to use external LLM providers:

1. **Navigate to the backend directory**:
   ```bash
   cd backend/
   ```

2. **Install Python dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure API keys**:
   - Copy `.env.example` to `.env`
   - Add your API keys for OpenAI, Google Gemini, or Anthropic

4. **Start the backend server**:
   ```bash
   python main.py
   ```

### Extension Settings

The extension contributes the following VS Code settings:

- `autodiff.showChangesView`: Show/hide the Changes panel (default: true)
- `autodiff.showResultsView`: Show/hide the Results panel (default: true)  
- `autodiff.showSettingsView`: Show/hide the Settings panel (default: true)
- `autodiff.backendUrl`: URL for external backend server (default: http://localhost:8000)
- `autodiff.defaultBaseBranch`: Default branch to compare against (default: origin/main)

## 🧪 Testing the Extension

### Development Setup

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd autodiff-extension
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Build the extension**:
   ```bash
   npm run compile
   ```

4. **Start development watchers** (optional):
   ```bash
   npm run watch:esbuild  # For production builds
   npm run watch:tsc      # For TypeScript compilation
   ```

### Testing in VS Code

1. **Open the project in VS Code**
2. **Press F5** to launch a new Extension Development Host window
3. **Open a Git repository** with some uncommitted changes
4. **Test the extension features**:
   - Open the AutoDiff panel
   - Try different review types
   - Check the output and results

### Running Unit Tests

```bash
npm test
```

### Backend Testing

Test the Python backend independently:

```bash
cd backend/
python -m unittest discover tests
```

## 📋 Example Output

When you run a review, you'll see results like:

```
🔒 **Security Issue Found**
File: src/auth.js
Line: 15
Severity: High
Issue: Hardcoded API key detected
Suggestion: Move API keys to environment variables

♿ **Accessibility Issue Found**  
File: components/Button.tsx
Line: 8
Severity: Medium
Issue: Button missing accessible label
Suggestion: Add aria-label or descriptive text
```

## 🔧 Architecture

- **Frontend**: TypeScript VS Code extension with tree view providers
- **Backend**: Python FastAPI server with LLM integrations
- **AI Integration**: Supports multiple LLM providers with unified interface
- **Git Integration**: Uses VS Code's Git API and command-line git

## 🐛 Known Issues

- Large diffs may exceed token limits for some LLM models
- Backend server must be running for external LLM provider features

## 🚧 Roadmap

- [ ] Inline code annotations with suggestions
- [ ] Integration with GitHub/GitLab pull request workflows  
- [ ] Custom rule configuration
- [ ] Team/project-specific review templates
- [ ] Automated fix suggestions

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

- **Issues**: Report bugs or request features on GitHub
- **Documentation**: Check the `/backend/README.md` for backend-specific details

---

**Happy reviewing! 🎉**
