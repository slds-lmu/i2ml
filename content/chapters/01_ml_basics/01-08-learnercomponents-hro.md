---
title: "Chapter 01.08: Components of a Learner"
weight: 1008
quizdown: true
---
Nearly all supervised learning algorithms can be described in terms of three components: 1) hypothesis space, 2) risk, and 3) optimization. In this section, we explain how these components interact and why this is a very useful concept for many supervised learning approaches.

<!--more-->

### Lecture video

{{< video id="PL7pDX9BBRc">}}

### Lecture slides

{{< pdfjs file="https://github.com/slds-lmu/lecture_i2ml/blob/master/slides-pdf/slides-basics-learnercomponents-hro.pdf" >}}

### Quiz

{{< quizdown >}}

---
shuffle_questions: false
---

## Which statements are true? 

- [x] For a given hypothesis space, different optimization procedures can be used to find the best model within it.
- [ ] Providing two different training data sets to a learner will result in the same optimal model.
- [x] The parameterization of a model defines its hypothesis space.
- [x] Supervised learning consists of three components: hypothesis space, risk, and optimization.

## Which statements are true? 

- [x] If a hypothesis space can be understood as a parameterized family of curves, finding the optimal model is equivalent to finding the optimal set of parameter values.
- [x] Supervised ML requires having labeled data to train the model.
- [ ] A learner is a function that maps feature vectors to predicted target values.
- [ ] The risk function does not depend on the choice of the loss function.

## Which statements are true?
- [ ] The idea of Gradient Descent (GD) is to iteratively go from the current candidate θ[t] in the direction of the positive gradient, with learning rate α to the next θ[t+1].
- [x] Empirical risk minimization (ERM) leads to finding the model with the lowest average loss (in the absence of regularization).
- [ ] A learner outputs the best parameters and hyperparameters.
- [ ] Supervised ML is always about learning to predict, and never about learning to explain.

## Which statements are true?
- [ ] In supervised ML, there are two tasks: Regression for categorical target variables, and classification for numerical ones.
- [x] An algorithm that - given some hypothesis space H, training data D, and hyperparameter control settings λ - returns one element of the hypothesis space H, is called a learner.
- [x] A hypothesis space H is a set that can have an infinite number of elements.
- [ ] The empirical risk function allows us to associate a quality score with each of our models: the higher the empirical risk, the better a model fits our training data.

{{< /quizdown >}}
