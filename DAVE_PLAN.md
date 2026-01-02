# Dave AI Agent Implementation Plan

**Project**: Building "Dave" - Your Personal Meal Planning Assistant  
**Timeline**: 4+1 day sprint  
**Goal**: Learn AI agent concepts while building a production-ready meal planning assistant

## Agent Concept

**Dave** is an intelligent agent that learns your preferences, dietary needs, and cooking habits to suggest weekly meal plans, automatically generate shopping lists, and adapt recommendations based on what you actually cook.

**Personality**: Helpful, conversational, and knowledgeable about food - like having a friend who's really good at meal planning.

## Learning Objectives

- [ ] **Message and Context Management**: Conversation state, threading, persistence
- [ ] **Tool Calling**: Function calling, structured outputs, database integration  
- [ ] **Orchestration**: N8N workflows, automation, event-driven architecture
- [ ] **Production Deployment**: Error handling, monitoring, user experience

## Technical Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   React UI      │◄──►│   Go API         │◄──►│   TiDB          │
│   (existing)    │    │   (existing)     │    │   (existing)    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                        │                       │
         ▼                        ▼                       │
┌─────────────────┐    ┌──────────────────┐              │
│   Dave Chat     │    │   AI Service     │              │
│   Component     │    │   (Node.js/new)  │              │
└─────────────────┘    └──────────────────┘              │
         │                        │                       │
         └────────────────────────┼───────────────────────┘
                                  │
                    ┌──────────────────┐    ┌─────────────────┐
                    │   N8N Workflows  │◄──►│  Vector Store   │
                    │   (orchestration)│    │  (optional)     │
                    └──────────────────┘    └─────────────────┘
```

## Implementation Plan

### Day 1: Foundation + Basic Tool Calling
**Status**: 🔄 In Progress

**Morning Tasks**:
- [x] Create `/pages/dave.js` - new page for AI chat
- [x] Build basic chat UI component
- [x] Set up Node.js AI service (separate from Go API)
- [x] Basic OpenAI API integration

**Afternoon Tasks**:
- [x] Implement simple recipe search tool calling
- [ ] Connect to existing recipe endpoints (`/recipes`, `/recipe/{id}`)
- [ ] Test basic conversation flow with tools

**Success Criteria**: 
- ✅ Dave can chat and maintain conversation context
- ⏳ Dave can search your recipe collection (mock data working)
- ⏳ Basic tool calling works with your existing API

**Learning Focus**: Message management, basic function calling

---

### Day 2: Recipe Integration + Shopping Lists
**Status**: ⏳ Not Started

**Morning Tasks**:
- [ ] Connect to all recipe/shopping APIs (`/shopping-list`, `/ingredients`)
- [ ] Implement conversation-to-shopping-list generation
- [ ] Add recipe recommendation logic

**Afternoon Tasks**:
- [ ] Build meal planning conversation flows
- [ ] Integration testing with existing shopping list feature
- [ ] Error handling for API calls

**Success Criteria**:
- ✅ Dave suggests recipes based on conversation
- ✅ Dave generates shopping lists from meal suggestions
- ✅ End-to-end meal planning conversation works

**Learning Focus**: Complex tool orchestration, data integration

---

### Day 3: N8N Orchestration
**Status**: ⏳ Not Started

**Morning Tasks**:
- [ ] Set up N8N instance
- [ ] Create basic workflows for meal planning
- [ ] Connect N8N to your APIs

**Afternoon Tasks**:
- [ ] Build automated weekly planning triggers
- [ ] Implement scheduled meal suggestions
- [ ] Test workflow automation

**Success Criteria**:
- ✅ N8N can trigger meal planning conversations
- ✅ Automated weekly planning works
- ✅ Workflows integrate with existing app

**Learning Focus**: Workflow automation, event-driven architecture

---

### Day 4: Production Polish
**Status**: ⏳ Not Started

**Morning Tasks**:
- [ ] Add proper error handling
- [ ] Polish chat UI/UX
- [ ] Basic monitoring and logging
- [ ] Add Dave to main navigation

**Afternoon Tasks**:
- [ ] Deploy and test full workflow
- [ ] User testing and feedback
- [ ] Documentation and cleanup

**Success Criteria**:
- ✅ Production-ready deployment
- ✅ Good user experience
- ✅ Stable and reliable

**Learning Focus**: Production deployment, monitoring, UX

---

### Day 5: Vector Embeddings Enhancement (Optional)
**Status**: ⏳ Not Started

**Morning Tasks**:
- [ ] Set up vector store (Pinecone or local)
- [ ] Embed existing recipes
- [ ] Implement semantic recipe search

**Afternoon Tasks**:
- [ ] Add "recipes similar to X" functionality
- [ ] Test improved recommendations
- [ ] Performance optimization

**Success Criteria**:
- ✅ Semantic recipe search works
- ✅ Much smarter recipe recommendations
- ✅ "Find recipes similar to pasta carbonara" functionality

**Learning Focus**: Vector embeddings, semantic search

## Current Progress

**Overall Status**: 🚀 Ready to Start  
**Current Phase**: Day 1 - Foundation  
**Next Action**: Set up basic chat UI and OpenAI integration

## Key Files to Create/Modify

### New Files:
- [ ] `/pages/dave.js` - Main chat page
- [ ] `/components/dave-chat/` - Chat UI components
- [ ] `/ai-service/` - Node.js AI service (new microservice)

### Existing Files to Modify:
- [ ] `/components/layout/index.js` - Add Dave navigation
- [ ] Database schema - Add conversation storage
- [ ] Environment variables - Add OpenAI API keys

## Success Metrics

- **Day 1**: Dave can maintain 5+ message conversations about food
- **Day 2**: Dave can suggest recipes and generate shopping lists based on conversation
- **Day 3**: Automated weekly meal planning workflows with N8N integration  
- **Day 4**: Production deployment with monitoring and user feedback
- **Day 5**: Semantic recipe search dramatically improves recommendations

## Learning Checkpoints

1. **Message Management**: Can you persist conversation state and retrieve context effectively?
2. **Tool Integration**: Does Dave successfully call your recipe APIs and return useful data?
3. **Orchestration**: Can N8N workflows trigger and coordinate multiple AI tasks?
4. **Production Ready**: Is the system handling errors gracefully and providing good user experience?
5. **Embeddings**: Does semantic search provide noticeably better recipe recommendations?

---

*Last Updated: 2025-12-30*  
*Status Legend: ⏳ Not Started | 🔄 In Progress | ✅ Complete | ❌ Blocked*