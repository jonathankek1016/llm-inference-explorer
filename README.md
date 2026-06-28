# 🧠 LLM Inference Explorer

An interactive educational visualization that helps explain, at a high
level, how modern Large Language Models (LLMs) generate responses.

Rather than focusing on the mathematics or low-level implementation
details of transformer architectures, this project aims to answer a
simpler question:

> **\"What happens after I press Enter?\"**

It visualizes the journey from a user\'s prompt to the model\'s final
response through an intuitive pipeline, while clearly distinguishing
between:

-   🟢 Real observable model behaviour and API outputs
-   🔵 Educational conceptual abstractions
-   🟡 Simplified illustrations of complex internal processes
-   ⚪ UI and presentation effects

The goal is not to reverse engineer proprietary models such as GPT,
Claude or Gemini, nor to expose hidden reasoning or chain-of-thought.
Instead, it serves as an educational companion for people beginning to
learn how transformer-based language models work.

## Why I built this

When I first started learning about LLMs, I found that many excellent
resources focused on the internal architecture of
transformers---attention heads, embeddings, residual connections, logits
and many other concepts.

While these resources are incredibly valuable, I often found myself
asking a much simpler question:

> **\"What is the AI actually doing while it is generating my reply?\"**

This project was created to help answer that question.

It combines real API outputs (where available) with clearly labelled
educational abstractions to provide a high-level mental model of the
inference process.

## Project Philosophy

This project values **clarity over complexity**.

Instead of attempting to reproduce every internal tensor operation, it
focuses on communicating the overall inference flow in a way that is
approachable for beginners.

If this visualization helps someone build an intuitive understanding
before diving into more advanced topics such as attention mechanisms, KV
cache, embeddings or interpretability research, then it has achieved its
purpose.

## Disclaimer

This project is an educational visualization designed to build an intuitive understanding of the LLM inference process.

It does **not** expose proprietary model internals, hidden states, weights, activations, or chain-of-thought. Sections labelled as **Educational** or **Illustrative** are conceptual abstractions intended for learning, not direct observations of how any specific model internally operates.

## About this project

This is my **first AI-assisted (\"vibe coded\") project** and also the
first software project that I am genuinely proud to share publicly.

It represents my personal learning journey into modern AI rather than an
attempt to demonstrate advanced software engineering skills.

I come from a cybersecurity and infrastructure background, and this
project reflects my curiosity about understanding AI systems through
visualization and interactive learning.

## Requirements

To use this application, simply provide your own OpenAI-compatible API key.

Your API key is stored locally in your browser for convenience and is **never included** in this repository.

## Features

- Interactive visualization of the LLM inference pipeline
- Step-by-step educational walkthrough of response generation
- Distinguishes between real observable behaviour, educational abstractions and UI presentation
- Browser-based application (no installation required)
- OpenAI-compatible API support
- Users provide their own API key (never included in this repository)

## Tech Stack

- HTML5
- CSS3
- Vanilla JavaScript
- OpenAI-compatible Chat Completions API

## Related Work

Many excellent projects explore transformer internals and model
interpretability in much greater depth.

This project is **not intended to replace them**.

Instead, it complements them by providing a higher-level educational
perspective aimed at newcomers.

I encourage anyone interested in learning more to also explore projects
such as:

- [Transformer Explainer](https://github.com/poloclub/transformer-explainer)
- [BertViz](https://github.com/jessevig/bertviz)
- [OpenAI Tokenizer](https://platform.openai.com/tokenizer)
- Other transformer visualization and interpretability tools

These projects provide significantly deeper insight into transformer
architectures and inspired me to continue learning.

## Known Issues

The current prototype is functional, but a few UI and state-management issues are still being investigated:

* **Interrupted generation state**

  * If generation is interrupted midway, the UI may clear the previous output before continuing from the partially generated response, resulting in inconsistent display behaviour.

* **Occasional placeholder response**

  * Under certain conditions, the assistant may incorrectly display the placeholder response ("Sure! Here's .....") instead of the expected model output.

* **Log probability viewport**

  * The log probability visualization automatically scrolls during generation, but the current token is not always kept fully within the visible viewport. As a result, users may need to manually scroll to follow the active token.

## Future Improvements

Some ideas I hope to explore in future versions include:

- Support for additional OpenAI-compatible providers (e.g. Anthropic, Google Gemini, OpenRouter and other compatible APIs)
- Support for local LLMs through OpenAI-compatible endpoints (e.g. Ollama)
- Image understanding / multimodal input support
- Real tokenizer integration (e.g. tiktoken) instead of simplified token visualization
- More accurate educational visualizations while maintaining a clear distinction between observable behaviour and conceptual abstractions
- Additional explanations for concepts such as embeddings, attention, KV cache, temperature and sampling
- Improved mobile responsiveness and tablet support
- General UI/UX improvements based on community feedback

As I continue learning about LLMs, I hope this project will continue improving alongside my understanding.

## Connect & Feedback

If this project helped you understand LLMs a little better, I\'d
genuinely love to hear about it.

Likewise, if you spot any inaccuracies, misleading explanations, or
think a concept could be presented more clearly, please don\'t hesitate
to let me know. I am still learning, and I welcome constructive feedback
from anyone with experience in AI, machine learning, or software
engineering. I would genuinely appreciate your feedback.

You are welcome to:

-   Open a GitHub Issue
-   Start a GitHub Discussion (if enabled)
-   Connect with me on [LinkedIn](https://www.linkedin.com/in/jonathan-kek/)

I enjoy meeting people who are curious about AI, cybersecurity,
infrastructure, and technology in general.

Every suggestion, correction, or discussion helps this project become a
better educational resource for the next person who is learning.

If this visualization helped you understand even one concept that
previously felt confusing, then I would consider this project a success.

Thank you for stopping by.

### Find me online

- GitHub: https://github.com/jonathankek1016
- LinkedIn: https://www.linkedin.com/in/jonathan-kek/