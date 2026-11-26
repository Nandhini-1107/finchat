const RESPONSES = {
    greeting:
        "Hello! I'm FinChat, your Finance and HR assistant. How can I help you today?",

    morning:
        "Good morning! How can I assist you today?",

    thanks:
        "You're welcome! Feel free to ask another question.",

    goodbye:
        "Goodbye! Have a great day!",

    help:
        "I can help you find information from approved company Finance and HR documents."
};

function detectConversationalIntent(question) {
    if (typeof question !== 'string') {
        return null;
    }

    const text = question
        .trim()
        .toLowerCase()
        .replace(/[.!?]+$/g, '')
        .trim();

    const patterns = [
        {
            intent: 'greeting',
            regex: /^(hi|hello|hey|hii|hai)$/
        },
        {
            intent: 'morning',
            regex: /^(good morning|good afternoon|good evening)$/
        },
        {
            intent: 'thanks',
            regex: /^(thanks|thank you|thank you so much)$/
        },
        {
            intent: 'goodbye',
            regex: /^(bye|goodbye|see you)$/
        },
        {
            intent: 'help',
            regex: /^(help|what can you do|who are you)$/
        }
    ];

    const matched = patterns.find(
        ({ regex }) => regex.test(text)
    );

    if (!matched) {
        return null;
    }

    return {
        intent: matched.intent,
        answer: RESPONSES[matched.intent]
    };
}

module.exports = {
    detectConversationalIntent
};