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
**Status**: ✅ Complete

**Morning Tasks**:
- [x] Create `/pages/dave.js` - new page for AI chat
- [x] Build basic chat UI component
- [x] Set up Node.js AI service (separate from Go API)
- [x] Basic OpenAI API integration

**Afternoon Tasks**:
- [x] Implement simple recipe search tool calling
- [x] Connect to existing recipe endpoints (`/recipes`, `/recipe/{id}`)
- [x] Test basic conversation flow with tools
- [x] Fix UX issues (remove IDs from user messages)
- [x] Improve search functionality (query + tags)
- [x] Debug tool calling behavior

**Success Criteria**: 
- ✅ Dave can chat and maintain conversation context
- ✅ Dave can search your recipe collection (real data working)
- ✅ Basic tool calling works with your existing API

**Learning Focus**: Message management, function calling, API integration

---

### Day 2: Evals & Testing Framework
**Status**: ✅ Complete

**Morning Tasks**:
- [x] Set up automated testing framework for Dave
- [x] Create eval dataset of conversation flows
- [x] Build test cases for tool calling behavior
- [x] Implement assertion checking for agent responses

**Afternoon Tasks**:
- [x] Test recipe search accuracy and tool calling
- [x] Test shopping list workflow end-to-end
- [x] Validate conversation context management
- [x] Performance and reliability testing

**Additional Achievements**:
- [x] **Fixed core tool calling issue**: Implemented iterative tool calling for multi-step workflows
- [x] **Built mock API server**: Authentication-free testing with realistic data
- [x] **Added integration testing**: API state verification and end-to-end validation
- [x] **100% test success rate**: All shopping list workflows now work correctly

**Success Criteria**:
- ✅ Automated test suite runs reliably
- ✅ Tool calling behavior is predictable and tested
- ✅ Conversation flows work consistently
- ✅ Can catch regressions in agent behavior

**Learning Focus**: AI testing methodologies, eval frameworks, quality assurance

---

### Day 3: Recipe Integration + Shopping Lists
**Status**: ⏳ Not Started

**Morning Tasks**:
- [ ] Enhanced recipe recommendations based on conversation
- [ ] Meal planning conversation flows
- [ ] Integration with existing shopping list features

**Afternoon Tasks**:
- [ ] Multi-recipe shopping list generation
- [ ] Conversation-driven meal planning
- [ ] Polish user experience and error handling

**Success Criteria**:
- ✅ Dave suggests recipes based on conversation context
- ✅ Dave generates comprehensive shopping lists
- ✅ End-to-end meal planning conversations work smoothly

**Learning Focus**: Complex conversation flows, recommendation logic

---

### Day 4: LangChain + LangSmith Integration
**Status**: ⏳ Not Started

**Morning Tasks**:
- [ ] Integrate LangChain framework with existing Dave setup
- [ ] Set up LangSmith account and project
- [ ] Migrate custom evals to LangSmith evaluation framework
- [ ] Configure tracing and monitoring

**Afternoon Tasks**:
- [ ] Build LangSmith evaluation datasets
- [ ] Implement industry-standard eval metrics
- [ ] Set up automated evaluation pipelines
- [ ] Compare custom vs LangSmith evaluation approaches

**Success Criteria**:
- ✅ Dave integrated with LangChain agents framework
- ✅ LangSmith capturing all conversation traces
- ✅ Evaluation pipeline running in LangSmith
- ✅ Understanding of production AI monitoring

**Learning Focus**: LangChain agents, LangSmith evaluation platform, production AI monitoring

---

### Day 5: N8N Orchestration + Production Monitoring
**Status**: ⏳ Not Started

**Morning Tasks**:
- [ ] Set up N8N instance
- [ ] Create workflows for automated meal planning
- [ ] Connect N8N to Dave APIs with LangSmith tracing

**Afternoon Tasks**:
- [ ] Build scheduled meal planning triggers
- [ ] Implement automated evaluation monitoring
- [ ] Set up alerts for evaluation failures
- [ ] Production monitoring dashboard

**Success Criteria**:
- ✅ N8N workflows trigger meal planning conversations
- ✅ All automated interactions traced in LangSmith
- ✅ Evaluation monitoring catches regressions
- ✅ Production-ready monitoring setup

**Learning Focus**: Workflow automation, production AI monitoring, automated evaluation

---

### Day 6: Vector Embeddings + Advanced Evaluation
**Status**: ⏳ Not Started

**Morning Tasks**:
- [ ] Set up vector store (Pinecone or local)
- [ ] Embed existing recipes for semantic search
- [ ] Implement semantic recipe recommendations

**Afternoon Tasks**:
- [ ] Build advanced evaluation metrics for semantic search
- [ ] A/B test keyword vs semantic search in LangSmith
- [ ] Performance benchmarking and optimization
- [ ] Final production deployment

**Success Criteria**:
- ✅ Semantic search dramatically improves recommendations
- ✅ A/B testing shows measurable improvement
- ✅ Full production deployment with monitoring
- ✅ Complete evaluation and monitoring pipeline

**Learning Focus**: Vector embeddings, semantic search, A/B testing, production deployment

## Current Progress

**Overall Status**: ✅ Day 2 Complete - Ready for Day 3  
**Current Phase**: Evaluation framework + iterative tool calling implemented  
**Key Achievement**: Dave's shopping list functionality now works end-to-end with 100% test coverage
**Next Action**: Move to Day 3 - Enhanced recipe recommendations and meal planning workflows

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